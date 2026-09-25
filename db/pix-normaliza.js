/**
 * Normalização da chave PIX — FONTE ÚNICA compartilhada por server.js e pelo
 * front (src/lib/utils.ts importa este módulo).
 *
 * Histórico: existiam DUAS cópias dessa lógica (uma em server.js, outra em
 * src/lib/utils.ts) e elas divergiam. A cópia do servidor não checava se o
 * valor tinha letras, então uma chave aleatória (EVP/UUID) cujo conteúdo
 * somasse 10, 11, 12, 13 ou 14 dígitos era reescrita como se fosse CPF ou
 * telefone. Medido: 1,18% das chaves aleatórias eram destruídas — a variável
 * ficava correta no painel do provedor e o QR gerado apontava para uma chave
 * inexistente.
 *
 * Regras:
 *  - e-mail            → minúsculas, nada mais
 *  - E.164 (+55…)      → remove espaços/parênteses/hífens
 *  - UUID (EVP)        → preservado integralmente
 *  - 11 dígitos        → CPF se os dígitos verificadores conferem; senão celular
 *  - 14 dígitos        → CNPJ se os dígitos verificadores conferem; senão preserva
 *  - 10 dígitos        → telefone BR sem DDI → +55…
 *  - 12–13 começando em 55 → E.164 sem o "+"
 *  - qualquer outro    → preserva o valor, só remove espaços
 */

/** Dígito verificador de CPF (mod 11). */
function cpfValido(digits) {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // 111.111.111-11 e cia.
  const calc = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(digits.slice(0, 9)) === Number(digits[9]) &&
    calc(digits.slice(0, 10)) === Number(digits[10]);
}

/** Dígito verificador de CNPJ (mod 11). */
function cnpjValido(digits) {
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false; // 00.000.000/0000-00 e cia.
  const calc = (base) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return calc(digits.slice(0, 12)) === Number(digits[12]) &&
    calc(digits.slice(0, 13)) === Number(digits[13]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remove aspas externas — .env e alguns painéis gravam PIX_CHAVE="valor". */
function semAspasExternas(s) {
  const m = s.match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2].trim() : s;
}

/**
 * @param {string} raw valor cru de PIX_CHAVE
 * @returns {string} chave pronta para o campo 26/01 do BR Code
 */
function normalizarChavePix(raw) {
  let s = semAspasExternas(String(raw == null ? '' : raw).trim());
  if (!s) return '';

  if (s.includes('@')) return s.toLowerCase();

  if (s.startsWith('+')) return s.replace(/[\s().-]/g, '');

  // Chave aleatória (EVP): nunca reinterpretar como número.
  if (UUID_RE.test(s)) return s.toLowerCase();

  const temLetra = /[a-zA-Z]/.test(s);
  const digits = s.replace(/\D/g, '');

  if (!temLetra && digits) {
    if (digits.length === 11) return cpfValido(digits) ? digits : `+55${digits}`;
    if (digits.length === 14) return cnpjValido(digits) ? digits : s.replace(/\s+/g, '');
    if (digits.length === 10 && /^[1-9]/.test(digits)) return `+55${digits}`;
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  }

  return s.replace(/\s+/g, '');
}

/**
 * Diz se a chave parece utilizável. Serve para avisar o operador no painel em
 * vez de renderizar um QR "bonito" que o banco vai recusar.
 * @param {string} raw
 * @returns {{ ok: boolean, tipo: string, motivo: string }}
 */
function inspecionarChavePix(raw) {
  const bruto = String(raw == null ? '' : raw).trim();
  if (/^['"]?0+['"]?$/.test(bruto)) {
    return { ok: false, tipo: 'placeholder', motivo: 'PIX_CHAVE é um placeholder de zeros' };
  }
  const chave = normalizarChavePix(raw);
  if (!chave) return { ok: false, tipo: 'vazia', motivo: 'PIX_CHAVE não está definida no servidor' };
  if (chave.includes('@')) return { ok: true, tipo: 'email', motivo: '' };
  if (/^\+55\d{10,11}$/.test(chave)) return { ok: true, tipo: 'telefone', motivo: '' };
  if (/^\d{11}$/.test(chave)) return { ok: true, tipo: 'cpf', motivo: '' };
  if (/^\d{14}$/.test(chave)) return { ok: true, tipo: 'cnpj', motivo: '' };
  if (UUID_RE.test(chave)) return { ok: true, tipo: 'aleatoria', motivo: '' };
  return { ok: false, tipo: 'desconhecida', motivo: 'Formato não reconhecido — confira PIX_CHAVE' };
}

module.exports = { normalizarChavePix, inspecionarChavePix, cpfValido, cnpjValido };

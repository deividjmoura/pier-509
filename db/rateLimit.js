// Rate limit em memória (janela deslizante).
// ATENÇÃO: não é compartilhado entre processos/instâncias.
// Em produção multi-instância use Redis (ou Cloudflare/Upstash).
const buckets = new Map();

function golpePermitido(chave, { janelaMs = 60_000, max = 30 } = {}) {
  const agora = Date.now();
  let lista = buckets.get(chave) || [];
  // remove timestamps fora da janela
  lista = lista.filter((t) => agora - t < janelaMs);
  if (lista.length >= max) {
    buckets.set(chave, lista);
    return false;
  }
  lista.push(agora);
  buckets.set(chave, lista);
  return true;
}

// Limpeza periódica (evita memory leak em chaves antigas)
setInterval(() => {
  const agora = Date.now();
  const maxAge = 60 * 60 * 1000; // 1h
  for (const [chave, lista] of buckets) {
    const viva = lista.filter((t) => agora - t < maxAge);
    if (viva.length) buckets.set(chave, viva);
    else buckets.delete(chave);
  }
}, 5 * 60 * 1000).unref();

/**
 * Consulta se a chave já estourou a cota, SEM registrar tentativa.
 * Usado no login: só tentativa que FALHOU conta (login correto não pode
 * consumir a cota de quem está entrando no turno).
 */
function golpeExcedido(chave, { janelaMs = 60_000, max = 30 } = {}) {
  const agora = Date.now();
  const lista = (buckets.get(chave) || []).filter((t) => agora - t < janelaMs);
  buckets.set(chave, lista);
  return lista.length >= max;
}

/** Registra uma tentativa na chave (ex.: senha errada). */
function registrarGolpe(chave) {
  const agora = Date.now();
  const lista = buckets.get(chave) || [];
  lista.push(agora);
  buckets.set(chave, lista);
}

/** Zera a chave (útil em teste e em login bem-sucedido, se quiser). */
function limparGolpes(chave) {
  buckets.delete(chave);
}

module.exports = { golpePermitido, golpeExcedido, registrarGolpe, limparGolpes };

/** Descrições coerentes quando o cadastro está vazio ou genérico. */

const GENERICA =
  /feito na hora,?\s*com a cara da casa|com a cara da casa|descri[cç][aã]o curta/i;

export function descricaoPadrao(nome: string, categoria?: string): string {
  const n = (nome || "Item").trim();
  const c = (categoria || "").toLowerCase();
  if (/dose/.test(c) || /dose/.test(n.toLowerCase())) {
    return `${n} — dose servida na hora. Escolha com ou sem gelo.`;
  }
  if (/drink|coquetel|drink/.test(c)) return `${n} — preparado na hora no bar.`;
  if (/cerveja|chopp|chope/.test(c)) return `${n} — servido gelado.`;
  if (/por[cç]|burger|lanche|hamb/.test(c)) return `${n} — montado na hora.`;
  if (/sobremesa|doce/.test(c)) return `${n} — finalização da casa.`;
  if (/bebida|refri|suco|agua|água/.test(c)) return `${n} — gelado.`;
  return n;
}

export function descricaoExibida(descricao: string | undefined | null, nome: string, categoria?: string): string {
  const d = String(descricao || "").trim();
  if (!d || GENERICA.test(d)) return descricaoPadrao(nome, categoria);
  return d;
}

export function isDoseProduto(nome: string, categoria?: string): boolean {
  return /dose/i.test(categoria || "") || /dose/i.test(nome || "");
}

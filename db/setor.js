/**
 * Setor de produção de um item: 'cozinha' (comida) ou 'bar' (bebida).
 *
 * Por que isto existe como módulo: a regra estava duplicada em db/admin.js e
 * ausente em db/seed.js. Resultado em banco novo: TODOS os 61 itens nasciam
 * com setor 'cozinha' (o default da coluna), porque o seed rodava depois da
 * migração 0013 (que só faz backfill do que já existe). A tela do Bar ficava
 * permanentemente vazia e as bebidas apareciam na chapa.
 *
 * A lista de palavras é a mesma usada no backfill da migração 0017.
 */

const SETOR_PADRAO = 'cozinha';

/** Palavras (sem acento, minúsculas) que indicam produção no bar. */
const PALAVRAS_BAR = [
  'bebida',
  'suco',
  'drink',
  'cerveja',
  'chopp',
  'chope',
  'long neck',
  'dose',
  'caipirinha',
  'caipiroska',
  'caipi',
  'destilado',
  'whisky',
  'vodka',
  'gin',
  'cachaca',
  'vinho',
  'espumante',
  'refrigerante',
  'energetico',
  'agua',
  'bar',
];

/** Normaliza para comparar: minúsculas e sem acento. */
function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Palpite de setor pelo nome da CATEGORIA (não do produto: "Água" é item de
 * "Bebidas", e "Porções" tem nome de comida).
 */
function setorDaCategoria(nomeCategoria) {
  const n = normalizar(nomeCategoria);
  if (!n) return SETOR_PADRAO;
  return PALAVRAS_BAR.some((p) => n.includes(p)) ? 'bar' : SETOR_PADRAO;
}

/** Valida um setor vindo do cliente; devolve null quando não é válido. */
function normalizarSetor(valor) {
  const v = String(valor || '').trim().toLowerCase();
  return v === 'bar' || v === 'cozinha' ? v : null;
}

module.exports = { SETOR_PADRAO, PALAVRAS_BAR, setorDaCategoria, normalizarSetor, normalizar };

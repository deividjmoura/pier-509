/**
 * Constantes estáticas da UI.
 *
 * O que era seed/demo (PRODUTOS_SEED, MESAS_SEED, STAFF, PIX_CONFIG, HERO_IMG,
 * GARCOM_TOKEN/NOME) saiu daqui: nada importava mais e o cardápio, as mesas e o
 * staff vêm do PostgreSQL. O STAFF em particular carregava senhas fixas
 * ("pub123") dentro do bundle publicado — resíduo e vazamento ao mesmo tempo.
 */

const CATEGORIAS_SEED: { id: number; nome: string; ordem: number }[] = [
  { id: 1, nome: "Lanches", ordem: 0 },
  { id: 2, nome: "Porções", ordem: 1 },
  { id: 3, nome: "Bebidas", ordem: 2 },
  { id: 4, nome: "Sobremesas", ordem: 3 },
];

/** nomes na ordem atual (compat com selects legados) */
export const CATEGORIAS = CATEGORIAS_SEED.map((c) => c.nome);

export const FRASES_GARCOM = [
  (m: string) => `Mesa ${m}! O cheiro bom já chegou, vem buscar!`,
  (m: string) => `Atenção, mesa ${m}! Lanche pronto e voando!`,
  (m: string) => `Mesa ${m} na área! Quentinho, direto da chapa!`,
  (m: string) => `Opa, mesa ${m}! Pedido pronto, corre que esfria!`,
];

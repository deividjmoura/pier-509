// Cardápio público, lido do Postgres, com cache em memória de curto prazo.
// Invalidar após qualquer mutação no admin (ver invalidarCardapio).
const pool = require('./pool');

const CARDAPIO_TTL_MS = Number(process.env.CARDAPIO_CACHE_TTL_MS || 30_000);

let cache = null;
let cacheAt = 0;
let produtosTemOrdem = null;

async function colunaProdutosOrdem() {
  if (produtosTemOrdem != null) return produtosTemOrdem;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'produtos' AND column_name = 'ordem'
        LIMIT 1`
    );
    produtosTemOrdem = rows.length > 0;
  } catch {
    produtosTemOrdem = false;
  }
  return produtosTemOrdem;
}

async function carregarCardapio() {
  const { rows: categorias } = await pool.query(
    'SELECT id, nome, ordem FROM categorias ORDER BY ordem ASC, id ASC'
  );

  const temOrdem = await colunaProdutosOrdem();
  const { rows: produtos } = await pool.query(
    temOrdem
      ? `SELECT id, categoria_id, nome, descricao, preco, foto_url, pede_ponto_carne, ordem
         FROM produtos
         WHERE disponivel = TRUE
           AND (controla_estoque = false OR estoque IS NULL OR estoque > 0)
         ORDER BY ordem ASC NULLS LAST, id ASC`
      : `SELECT id, categoria_id, nome, descricao, preco, foto_url, pede_ponto_carne
         FROM produtos
         WHERE disponivel = TRUE
           AND (controla_estoque = false OR estoque IS NULL OR estoque > 0)
         ORDER BY id ASC`
  );

  const { rows: adicionais } = await pool.query(
    'SELECT id, produto_id, nome, preco FROM adicionais ORDER BY id'
  );
  const { rows: removiveis } = await pool.query(
    'SELECT produto_id, ingrediente FROM produtos_ingredientes_removiveis'
  );

  return categorias.map((cat) => ({
    id: cat.id,
    nome: cat.nome,
    ordem: cat.ordem != null ? Number(cat.ordem) : 0,
    produtos: produtos
      .filter((p) => p.categoria_id === cat.id)
      .map((p) => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        preco: Number(p.preco),
        fotoUrl: p.foto_url,
        pedePontoCarne: p.pede_ponto_carne,
        ordem: p.ordem != null ? Number(p.ordem) : 0,
        adicionais: adicionais
          .filter((a) => a.produto_id === p.id)
          .map((a) => ({ id: a.id, nome: a.nome, preco: Number(a.preco) })),
        removiveis: removiveis
          .filter((r) => r.produto_id === p.id)
          .map((r) => r.ingrediente),
      })),
  }));
}

async function getCardapio() {
  if (cache && Date.now() - cacheAt < CARDAPIO_TTL_MS) {
    return cache;
  }
  cache = await carregarCardapio();
  cacheAt = Date.now();
  return cache;
}

function invalidarCardapio() {
  cache = null;
  cacheAt = 0;
  produtosTemOrdem = null;
}

module.exports = { getCardapio, invalidarCardapio };

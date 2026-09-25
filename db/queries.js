// Helpers compartilhados entre as rotas que já foram migradas pro Postgres.
// Nada aqui grava dado transacional sozinho — quem faz isso é db/pedidos.js,
// dentro de transações. Este módulo só lê e resolve a sessão da mesa.

const TRANSICOES = {
  recebido: 'em_producao',
  em_producao: 'concluido',
  concluido: 'entregue',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}

async function getMesaPorToken(client, token) {
  if (!isUuid(token)) return null;
  const { rows } = await client.query(
    'SELECT id, numero, status FROM mesas WHERE token = $1',
    [token.trim()]
  );
  return rows[0] || null;
}

// Abre/reaproveita a sessão aberta da mesa de forma serializada.
// O lock na linha da mesa impede que duas transações simultâneas observem
// "nenhuma sessão aberta" ao mesmo tempo. Assim não dependemos de capturar
// uma violação 23505 dentro da mesma transação, que deixaria o PostgreSQL em
// estado abortado até ROLLBACK/SAVEPOINT.
async function getOuAbrirSessao(client, mesaId) {
  const { rows: mesas } = await client.query(
    'SELECT id FROM mesas WHERE id = $1 FOR UPDATE',
    [mesaId]
  );
  if (!mesas[0]) return null;

  const { rows: abertas } = await client.query(
    "SELECT id FROM mesa_sessoes WHERE mesa_id = $1 AND status = 'aberta'",
    [mesaId]
  );
  if (abertas[0]) return abertas[0].id;

  const { rows: novas } = await client.query(
    'INSERT INTO mesa_sessoes (mesa_id) VALUES ($1) RETURNING id',
    [mesaId]
  );
  await client.query("UPDATE mesas SET status = 'ocupada' WHERE id = $1", [mesaId]);
  return novas[0].id;
}

// Lê o produto junto com as regras que o servidor precisa pra validar o item
// do pedido (nunca confiar em preço/adicional/remoção vindos do cliente).
async function getProdutoComRegras(client, produtoId) {
  if (!Number.isInteger(produtoId) || produtoId < 1) return null;
  const { rows } = await client.query(
    'SELECT id, nome, preco, disponivel, pede_ponto_carne, controla_estoque, estoque FROM produtos WHERE id = $1',
    [produtoId]
  );
  if (!rows[0]) return null;

  const { rows: adicionais } = await client.query(
    'SELECT id, nome, preco FROM adicionais WHERE produto_id = $1',
    [produtoId]
  );
  const { rows: removiveis } = await client.query(
    'SELECT ingrediente FROM produtos_ingredientes_removiveis WHERE produto_id = $1',
    [produtoId]
  );

  return {
    ...rows[0],
    adicionaisPermitidos: adicionais,
    removiveisPermitidos: removiveis.map((r) => r.ingrediente),
  };
}

module.exports = { TRANSICOES, getMesaPorToken, getOuAbrirSessao, getProdutoComRegras };

// Cliente informa PIX (por pedido ou total). Só avisa o caixa; baixa do valor
// acontece quando o caixa confirma o aviso (pagamento parcial).
const pool = require('./pool');
const { numeroInteiroPositivo } = require('./validacao');

class ErroPixCliente extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @deprecated Mantido só para scripts CLI (`npm run test:dia`, smoke) em bancos
 * antigos. Em runtime o schema vem de `db/migrations/0016_pix_avisos.sql` —
 * nenhum handler de requisição deve chamar isto (era DDL no caminho do pedido).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Token de mesa é UUID v1–v5; qualquer outra coisa é entrada malformada, não "mesa inexistente". */
function validarUuid(valor, nome = 'Token') {
  if (typeof valor !== 'string' || !UUID_RE.test(valor.trim())) {
    throw new ErroPixCliente(400, `${nome} inválido`);
  }
  return valor.trim();
}

/** Aceita '12,50' do mobile; rejeita boolean/objeto/NaN em vez de virar default. */
function valorPositivo(valor, nome = 'Valor') {
  if (typeof valor === 'boolean' || (typeof valor !== 'number' && typeof valor !== 'string')) {
    throw new ErroPixCliente(400, `${nome} inválido`);
  }
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor.trim().replace(',', '.')) : valor;
  if (!Number.isFinite(n) || n <= 0) throw new ErroPixCliente(400, `${nome} inválido`);
  return Number(n.toFixed(2));
}

async function ensurePixAvisosTable(db) {
  const q = db && typeof db.query === 'function' ? db : pool;
  await q.query(`
    CREATE TABLE IF NOT EXISTS pix_avisos (
      id SERIAL PRIMARY KEY,
      sessao_id INT NOT NULL REFERENCES mesa_sessoes(id) ON DELETE CASCADE,
      pedido_id INT REFERENCES pedidos(id) ON DELETE SET NULL,
      valor NUMERIC(12,2) NOT NULL,
      cliente_nome TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmado_em TIMESTAMPTZ
    )
  `);
  await q.query(`
    CREATE INDEX IF NOT EXISTS idx_pix_avisos_sessao_status
    ON pix_avisos (sessao_id, status)
  `);
}

/**
 * body: { pedidoId?: number, valor?: number, clienteNome?: string }
 * - Com pedidoId: aviso parcial daquele pedido (valor = total do pedido se omitido)
 * - Sem pedidoId: aviso do restante da conta
 */
async function informarPixPago(token, body = {}) {
  const tokenValidado = validarUuid(token, 'Token da mesa');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ErroPixCliente(400, 'Dados do PIX inválidos');
  }

  // Campos explícitos são validados; só o campo omitido cai no default do pedido.
  let pedidoId = null;
  if (body.pedidoId !== undefined && body.pedidoId !== null && body.pedidoId !== '') {
    pedidoId = numeroInteiroPositivo(body.pedidoId, 'Pedido');
  }
  let valorAviso = null;
  if (body.valor !== undefined && body.valor !== null && body.valor !== '') {
    valorAviso = valorPositivo(body.valor);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: mesas } = await client.query(
      'SELECT id, numero FROM mesas WHERE token = $1',
      [tokenValidado]
    );
    if (!mesas.length) throw new ErroPixCliente(404, 'Mesa não encontrada');
    const mesa = mesas[0];

    const { rows: sessaoRows } = await client.query(
      `SELECT id, valor_total, pix_informado_em
       FROM mesa_sessoes
       WHERE mesa_id = $1 AND status = 'aberta'
       FOR UPDATE`,
      [mesa.id]
    );
    if (!sessaoRows.length) {
      throw new ErroPixCliente(400, 'Nenhuma conta aberta nesta mesa');
    }
    const sessao = sessaoRows[0];
    const sessaoId = sessao.id;

    const { rows: sumRows } = await client.query(
      `SELECT COALESCE(SUM(valor), 0)::float AS pago
       FROM sessao_pagamentos WHERE sessao_id = $1`,
      [sessaoId]
    );
    const valorPago = Number(sumRows[0].pago || 0);
    // total devido = valor_total da sessão (já só entregues no fluxo atual)
    const valorTotal = Number(sessao.valor_total || 0);
    const valorRestante = Number(Math.max(0, valorTotal - valorPago).toFixed(2));

    if (valorRestante <= 0.009) {
      throw new ErroPixCliente(
        400,
        'Nada a pagar no momento — a conta já está quitada ou ainda não há pedidos entregues.'
      );
    }

    let clienteNome = String(body.clienteNome || body.cliente_nome || '').trim().slice(0, 80) || null;

    if (pedidoId) {
      const { rows: pedRows } = await client.query(
        `SELECT p.id, p.status, p.cliente_nome, p.sessao_id
         FROM pedidos p
         WHERE p.id = $1 AND p.sessao_id = $2`,
        [pedidoId, sessaoId]
      );
      if (!pedRows.length) throw new ErroPixCliente(404, 'Pedido não encontrado nesta mesa');
      if (pedRows[0].status !== 'entregue') {
        throw new ErroPixCliente(400, 'Só é possível avisar PIX de pedido já entregue');
      }
      if (!clienteNome) clienteNome = pedRows[0].cliente_nome || null;

      // soma itens do pedido
      const { rows: itens } = await client.query(
        `SELECT ip.quantidade, ip.preco_unitario,
                COALESCE((
                  SELECT SUM(ipa.preco_unitario) FROM itens_pedido_adicionais ipa
                  WHERE ipa.item_pedido_id = ip.id
                ), 0) AS ad
         FROM itens_pedido ip WHERE ip.pedido_id = $1`,
        [pedidoId]
      );
      const totalPedido = itens.reduce(
        (s, it) => s + Number(it.quantidade) * (Number(it.preco_unitario) + Number(it.ad || 0)),
        0
      );
      if (valorAviso == null) {
        valorAviso = Number(totalPedido.toFixed(2));
      }
    } else if (valorAviso == null) {
      valorAviso = valorRestante;
    }

    if (valorAviso <= 0) {
      throw new ErroPixCliente(400, 'Valor inválido: não há valor positivo para informar');
    }
    if (valorAviso > valorRestante + 0.009) {
      throw new ErroPixCliente(
        400,
        `Valor maior que o restante da conta (R$ ${valorRestante.toFixed(2).replace('.', ',')})`
      );
    }

    // evita spam: se já existe aviso pendente igual (mesmo pedido + valor), só renova timestamp
    const { rows: existing } = await client.query(
      `SELECT id FROM pix_avisos
       WHERE sessao_id = $1 AND status = 'pendente'
         AND COALESCE(pedido_id, 0) = COALESCE($2::int, 0)
         AND ABS(valor - $3) < 0.02
       LIMIT 1`,
      [sessaoId, pedidoId, valorAviso]
    );

    let avisoId;
    if (existing.length) {
      const { rows: up } = await client.query(
        `UPDATE pix_avisos SET criado_em = now(), cliente_nome = COALESCE($2, cliente_nome)
         WHERE id = $1
         RETURNING id, criado_em`,
        [existing[0].id, clienteNome]
      );
      avisoId = up[0].id;
    } else {
      const { rows: ins } = await client.query(
        `INSERT INTO pix_avisos (sessao_id, pedido_id, valor, cliente_nome, status)
         VALUES ($1, $2, $3, $4, 'pendente')
         RETURNING id, criado_em`,
        [sessaoId, pedidoId, valorAviso, clienteNome]
      );
      avisoId = ins[0].id;
    }

    const { rows: updated } = await client.query(
      `UPDATE mesa_sessoes
       SET pix_informado_em = now()
       WHERE id = $1
       RETURNING id, pix_informado_em`,
      [sessaoId]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      mesa: mesa.numero,
      sessaoId,
      avisoId,
      pedidoId,
      valorAvisado: valorAviso,
      clienteNome,
      pixInformadoEm: updated[0].pix_informado_em,
      valorTotal,
      valorPago,
      valorRestante,
      pagamento: null,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw erroDeSchema(err);
  } finally {
    client.release();
  }
}

/** Relation não encontrada (pg 42P01) = banco sem migrations; devolve 503 claro. */
function erroDeSchema(err) {
  if (err && (err.code === '42P01' || /pix_avisos/.test(String(err && err.message)) && /does not exist/i.test(String(err && err.message)))) {
    return new ErroPixCliente(503, 'Schema desatualizado no servidor — rode `npm run db:migrate`.');
  }
  return err;
}

module.exports = {
  informarPixPago,
  ErroPixCliente,
  ensurePixAvisosTable,
  erroDeSchema,
  validarUuid,
  valorPositivo,
};

// Limpeza de histórico: remove sessões fechadas e TODO o que depende delas.
const pool = require('./pool');

class ErroPurge extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Conta o que seria apagado (dry-run) ou executa o purge.
 * Só mexe em sessões **fechadas** com fechada_em::date < before.
 * Nunca apaga sessão aberta nem pedido de mesa ativa.
 *
 * Apaga de TODOS os lugares: pedidos, itens, pagamentos parciais, sessões.
 * (relatório/dashboard passam a não enxergar esses dados)
 *
 * @param {{ before: string, confirm?: boolean, dryRun?: boolean }} opts
 * before = YYYY-MM-DD (exclusivo: apaga tudo com data de fechamento **antes** desse dia)
 */
async function purgeHistorico(opts = {}) {
  const before = opts.before;
  const confirm = opts.confirm === true;
  const dryRun = opts.dryRun === true || !confirm;

  if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    throw new ErroPurge('Informe before (YYYY-MM-DD)');
  }

  const client = await pool.connect();
  try {
    const { rows: counts } = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM mesa_sessoes
           WHERE status = 'fechada' AND fechada_em::date < $1::date) AS sessoes,
         (SELECT COUNT(*)::int FROM pedidos p
           JOIN mesa_sessoes s ON s.id = p.sessao_id
           WHERE s.status = 'fechada' AND s.fechada_em::date < $1::date) AS pedidos,
         (SELECT COUNT(*)::int FROM itens_pedido ip
           JOIN pedidos p ON p.id = ip.pedido_id
           JOIN mesa_sessoes s ON s.id = p.sessao_id
           WHERE s.status = 'fechada' AND s.fechada_em::date < $1::date) AS itens,
         (SELECT COUNT(*)::int FROM sessao_pagamentos sp
           JOIN mesa_sessoes s ON s.id = sp.sessao_id
           WHERE s.status = 'fechada' AND s.fechada_em::date < $1::date) AS pagamentos`,
      [before]
    );
    const preview = {
      before,
      sessoes: counts[0].sessoes,
      pedidos: counts[0].pedidos,
      itens: counts[0].itens,
      pagamentos: counts[0].pagamentos,
    };

    if (dryRun) {
      return { dryRun: true, deleted: false, ...preview };
    }

    if (preview.sessoes === 0 && preview.pedidos === 0) {
      return {
        dryRun: false,
        deleted: true,
        ...preview,
        message: 'Nada para apagar neste período.',
      };
    }

    await client.query('BEGIN');

    // Filhos dos itens
    await client.query(
      `DELETE FROM itens_pedido_adicionais
       WHERE item_pedido_id IN (
         SELECT ip.id FROM itens_pedido ip
         JOIN pedidos p ON p.id = ip.pedido_id
         JOIN mesa_sessoes s ON s.id = p.sessao_id
         WHERE s.status = 'fechada' AND s.fechada_em::date < $1::date
       )`,
      [before]
    );

    await client.query(
      `DELETE FROM itens_pedido_remocoes
       WHERE item_pedido_id IN (
         SELECT ip.id FROM itens_pedido ip
         JOIN pedidos p ON p.id = ip.pedido_id
         JOIN mesa_sessoes s ON s.id = p.sessao_id
         WHERE s.status = 'fechada' AND s.fechada_em::date < $1::date
       )`,
      [before]
    );

    await client.query(
      `DELETE FROM itens_pedido
       WHERE pedido_id IN (
         SELECT p.id FROM pedidos p
         JOIN mesa_sessoes s ON s.id = p.sessao_id
         WHERE s.status = 'fechada' AND s.fechada_em::date < $1::date
       )`,
      [before]
    );

    await client.query(
      `DELETE FROM pedidos
       WHERE sessao_id IN (
         SELECT id FROM mesa_sessoes
         WHERE status = 'fechada' AND fechada_em::date < $1::date
       )`,
      [before]
    );

    // Pagamentos parciais das sessões (além do CASCADE, explícito para clareza)
    await client.query(
      `DELETE FROM sessao_pagamentos
       WHERE sessao_id IN (
         SELECT id FROM mesa_sessoes
         WHERE status = 'fechada' AND fechada_em::date < $1::date
       )`,
      [before]
    );

    const delSess = await client.query(
      `DELETE FROM mesa_sessoes
       WHERE status = 'fechada' AND fechada_em::date < $1::date
       RETURNING id`,
      [before]
    );

    await client.query('COMMIT');

    return {
      dryRun: false,
      deleted: true,
      before,
      sessoes: delSess.rowCount,
      pedidos: preview.pedidos,
      itens: preview.itens,
      pagamentos: preview.pagamentos,
      message:
        `Removido de TODOS os lugares: ${delSess.rowCount} sessão(ões), ` +
        `${preview.pedidos} pedido(s), ${preview.pagamentos} pagamento(s) ` +
        `fechados antes de ${before}. Histórico, relatório e dashboard não mostram mais esses dados.`,
    };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { purgeHistorico, ErroPurge };

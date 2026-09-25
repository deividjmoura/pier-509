// Relatório de vendas por período (dados para PDF / impressão).
const pool = require('./pool');
const { resumoDia } = require('./dashboard');

/** Só permite nomes de fuso seguros (evita injection em literal SQL). */
function tzSeguro() {
  const raw = String(process.env.APP_TIMEZONE || 'America/Sao_Paulo').trim();
  if (/^[A-Za-z0-9_+\-\/]+$/.test(raw) && raw.length <= 64) return raw;
  return 'America/Sao_Paulo';
}

/**
 * Intervalo [from 00:00, to+1 00:00) no fuso do pub, como timestamptz.
 * Funciona com colunas timestamp e timestamptz no Postgres/Neon.
 */
function sqlRangeParams(from, to, tz) {
  // from 00:00 no fuso local → instante UTC
  // to é inclusivo → upper bound = (to + 1 dia) 00:00 local
  return {
    textStart: `($1::timestamp AT TIME ZONE '${tz}')`,
    textEnd: `((($2::date + 1)::timestamp) AT TIME ZONE '${tz}')`,
    values: [from, to],
  };
}

/**
 * @param {{ from: string, to: string }} opts  YYYY-MM-DD obrigatórios
 */
async function relatorioVendas({ from, to }) {
  if (!from || !to) {
    const err = new Error('Informe from e to (YYYY-MM-DD)');
    err.status = 400;
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const err = new Error('Datas inválidas. Use YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  if (from > to) {
    const err = new Error('"De" não pode ser depois de "Até"');
    err.status = 400;
    throw err;
  }

  const tz = tzSeguro();
  const range = sqlRangeParams(from, to, tz);

  let resumo;
  try {
    resumo = await resumoDia({ from, to });
  } catch (e) {
    console.error('[relatorio] resumoDia falhou:', e.message || e);
    // não derruba o relatório inteiro — devolve zeros
    resumo = {
      faturamento: 0,
      contasFechadas: 0,
      ticketMedio: 0,
      porFormaPagamento: {},
      pedidosTotal: 0,
      pedidosPorStatus: {},
      topProdutos: [],
    };
  }

  let porDia = [];
  try {
    const q = await pool.query(
      `SELECT (fechada_em AT TIME ZONE '${tz}')::date AS dia,
              COUNT(*)::int AS contas,
              COALESCE(SUM(COALESCE(valor_cobrado, valor_total)), 0)::float AS faturamento
       FROM mesa_sessoes
       WHERE status = 'fechada'
         AND fechada_em >= ${range.textStart}
         AND fechada_em < ${range.textEnd}
       GROUP BY 1
       ORDER BY 1`,
      range.values
    );
    porDia = q.rows.map((r) => ({
      dia: r.dia instanceof Date ? r.dia.toISOString().slice(0, 10) : String(r.dia).slice(0, 10),
      contas: r.contas,
      faturamento: Number(Number(r.faturamento || 0).toFixed(2)),
    }));
  } catch (e) {
    console.error('[relatorio] porDia falhou:', e.message || e);
    // fallback sem timezone
    try {
      const q = await pool.query(
        `SELECT fechada_em::date AS dia,
                COUNT(*)::int AS contas,
                COALESCE(SUM(COALESCE(valor_cobrado, valor_total)), 0)::float AS faturamento
         FROM mesa_sessoes
         WHERE status = 'fechada'
           AND fechada_em::date >= $1::date
           AND fechada_em::date <= $2::date
         GROUP BY 1
         ORDER BY 1`,
        [from, to]
      );
      porDia = q.rows.map((r) => ({
        dia: r.dia instanceof Date ? r.dia.toISOString().slice(0, 10) : String(r.dia).slice(0, 10),
        contas: r.contas,
        faturamento: Number(Number(r.faturamento || 0).toFixed(2)),
      }));
    } catch (e2) {
      console.error('[relatorio] porDia fallback falhou:', e2.message || e2);
    }
  }

  let sessoes = [];
  try {
    const q = await pool.query(
      `SELECT s.id, s.valor_total, s.desconto, s.taxa_servico, s.valor_cobrado,
              s.forma_pagamento, s.fechada_em, s.cliente_nome,
              m.numero AS mesa
       FROM mesa_sessoes s
       JOIN mesas m ON m.id = s.mesa_id
       WHERE s.status = 'fechada'
         AND s.fechada_em >= ${range.textStart}
         AND s.fechada_em < ${range.textEnd}
       ORDER BY s.fechada_em DESC
       LIMIT 500`,
      range.values
    );
    sessoes = q.rows;
  } catch (e) {
    console.error('[relatorio] sessoes falhou:', e.message || e);
    try {
      const q = await pool.query(
        `SELECT s.id, s.valor_total, s.desconto, s.taxa_servico, s.valor_cobrado,
                s.forma_pagamento, s.fechada_em, s.cliente_nome,
                m.numero AS mesa
         FROM mesa_sessoes s
         JOIN mesas m ON m.id = s.mesa_id
         WHERE s.status = 'fechada'
           AND s.fechada_em::date >= $1::date
           AND s.fechada_em::date <= $2::date
         ORDER BY s.fechada_em DESC
         LIMIT 500`,
        [from, to]
      );
      sessoes = q.rows;
    } catch (e2) {
      console.error('[relatorio] sessoes fallback falhou:', e2.message || e2);
      const err = new Error('Falha ao consultar contas fechadas: ' + (e2.message || e.message));
      err.status = 500;
      throw err;
    }
  }

  return {
    geradoEm: new Date().toISOString(),
    periodo: { from, to, timezone: tz },
    resumo: {
      faturamento: resumo.faturamento,
      contasFechadas: resumo.contasFechadas,
      ticketMedio: resumo.ticketMedio,
      porFormaPagamento: resumo.porFormaPagamento || {},
      pedidosTotal: resumo.pedidosTotal || 0,
      pedidosPorStatus: resumo.pedidosPorStatus || {},
      topProdutos: resumo.topProdutos || [],
    },
    porDia,
    contas: sessoes.map((s) => {
      const base = Number(s.valor_total || 0);
      const cobrado = s.valor_cobrado != null ? Number(s.valor_cobrado) : base;
      return {
        id: s.id,
        mesa: s.mesa,
        cliente: s.cliente_nome || null,
        valor: Number(base.toFixed(2)),
        desconto: Number(Number(s.desconto || 0).toFixed(2)),
        taxaServico: Number(Number(s.taxa_servico || 0).toFixed(2)),
        valorCobrado: Number(cobrado.toFixed(2)),
        forma: s.forma_pagamento || 'outro',
        fechadaEm: s.fechada_em,
      };
    }),
  };
}

module.exports = { relatorioVendas };

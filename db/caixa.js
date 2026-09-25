// Caixa: sessões abertas, pagamentos parciais (divisão) e fechamento.
const pool = require('./pool');
const { erroDeSchema } = require('./pix-cliente');

const FORMAS = new Set(['dinheiro', 'pix', 'cartao_debito', 'cartao_credito']);

class ErroCaixa extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function montarItensComExtras(itensRows, addByItem, remByItem) {
  return itensRows.map((item) => {
    const adicionais = addByItem.get(item.id) || [];
    const remocoes = remByItem.get(item.id) || [];
    const totalAdicionais = adicionais.reduce((s, a) => s + a.preco, 0);
    const precoUnitario = Number(item.preco_unitario);
    return {
      id: item.id,
      nome: item.nome,
      quantidade: item.quantidade,
      preco_unitario: item.preco_unitario,
      ponto_carne: item.ponto_carne,
      observacao: item.observacao,
      adicionais,
      remocoes,
      precoUnitario,
      subtotal: Number(((precoUnitario + totalAdicionais) * item.quantidade).toFixed(2)),
    };
  });
}

function parseMoney(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Number(n.toFixed(2));
}

async function listSessoesAbertas() {
  const { rows: sessoes } = await pool.query(
    `SELECT s.id, s.aberta_em, s.valor_total, s.pix_informado_em, s.cliente_nome,
            m.id AS mesa_id, m.numero AS mesa
     FROM mesa_sessoes s
     JOIN mesas m ON m.id = s.mesa_id
     WHERE s.status = 'aberta'
     ORDER BY m.numero`
  );
  if (!sessoes.length) return [];

  const sessaoIds = sessoes.map((s) => s.id);
  const { rows: pedidos } = await pool.query(
    `SELECT id, sessao_id, status, criado_em, observacao_geral, cliente_nome
     FROM pedidos
     WHERE sessao_id = ANY($1::int[])
     ORDER BY criado_em`,
    [sessaoIds]
  );

  const { rows: pagRows } = await pool.query(
    `SELECT id, sessao_id, valor, forma_pagamento, criado_em
     FROM sessao_pagamentos
     WHERE sessao_id = ANY($1::int[])
     ORDER BY criado_em`,
    [sessaoIds]
  ).catch(() => ({ rows: [] }));

  const pagBySessao = new Map();
  for (const p of pagRows) {
    if (!pagBySessao.has(p.sessao_id)) pagBySessao.set(p.sessao_id, []);
    pagBySessao.get(p.sessao_id).push({
      id: p.id,
      valor: Number(p.valor),
      formaPagamento: p.forma_pagamento,
      criadoEm: p.criado_em,
    });
  }

  let avisoRows = [];
  try {
    const av = await pool.query(
      `SELECT a.id, a.sessao_id, a.pedido_id, a.valor, a.cliente_nome, a.status, a.criado_em
       FROM pix_avisos a
       WHERE a.sessao_id = ANY($1::int[]) AND a.status = 'pendente'
       ORDER BY a.criado_em`,
      [sessaoIds]
    );
    avisoRows = av.rows;
  } catch (_) {
    avisoRows = [];
  }
  const avisosBySessao = new Map();
  for (const a of avisoRows) {
    if (!avisosBySessao.has(a.sessao_id)) avisosBySessao.set(a.sessao_id, []);
    avisosBySessao.get(a.sessao_id).push({
      id: a.id,
      pedidoId: a.pedido_id,
      valor: Number(a.valor),
      clienteNome: a.cliente_nome || null,
      criadoEm: a.criado_em,
    });
  }


  const entregueIds = pedidos.filter((p) => p.status === 'entregue').map((p) => p.id);
  let itensRows = [];
  const addByItem = new Map();
  const remByItem = new Map();

  if (entregueIds.length) {
    const itensRes = await pool.query(
      `SELECT ip.id, ip.pedido_id, pr.nome, ip.quantidade, ip.preco_unitario, ip.ponto_carne, ip.observacao
       FROM itens_pedido ip
       JOIN produtos pr ON pr.id = ip.produto_id
       WHERE ip.pedido_id = ANY($1::int[])
       ORDER BY ip.id`,
      [entregueIds]
    );
    itensRows = itensRes.rows;
    const itemIds = itensRows.map((i) => i.id);
    if (itemIds.length) {
      const [adRes, remRes] = await Promise.all([
        pool.query(
          `SELECT ipa.item_pedido_id, a.nome, ipa.preco_unitario
           FROM itens_pedido_adicionais ipa
           JOIN adicionais a ON a.id = ipa.adicional_id
           WHERE ipa.item_pedido_id = ANY($1::int[])`,
          [itemIds]
        ),
        pool.query(
          `SELECT item_pedido_id, ingrediente
           FROM itens_pedido_remocoes
           WHERE item_pedido_id = ANY($1::int[])`,
          [itemIds]
        ),
      ]);
      for (const a of adRes.rows) {
        if (!addByItem.has(a.item_pedido_id)) addByItem.set(a.item_pedido_id, []);
        addByItem.get(a.item_pedido_id).push({ nome: a.nome, preco: Number(a.preco_unitario) });
      }
      for (const r of remRes.rows) {
        if (!remByItem.has(r.item_pedido_id)) remByItem.set(r.item_pedido_id, []);
        remByItem.get(r.item_pedido_id).push(r.ingrediente);
      }
    }
  }

  const itensByPedido = new Map();
  for (const item of itensRows) {
    if (!itensByPedido.has(item.pedido_id)) itensByPedido.set(item.pedido_id, []);
    itensByPedido.get(item.pedido_id).push(item);
  }

  const pedidosBySessao = new Map();
  for (const p of pedidos) {
    if (!pedidosBySessao.has(p.sessao_id)) pedidosBySessao.set(p.sessao_id, []);
    pedidosBySessao.get(p.sessao_id).push(p);
  }

  return sessoes.map((s) => {
    const lista = pedidosBySessao.get(s.id) || [];
    const entregues = [];
    let pendentes = 0;
    for (const p of lista) {
      if (p.status === 'entregue') {
        const raw = itensByPedido.get(p.id) || [];
        const itens = montarItensComExtras(raw, addByItem, remByItem);
        const totalPedido = Number(itens.reduce((acc, i) => acc + i.subtotal, 0).toFixed(2));
        entregues.push({
          id: p.id,
          criadoEm: p.criado_em,
          observacaoGeral: p.observacao_geral,
          clienteNome: p.cliente_nome || null,
          itens,
          total: totalPedido,
        });
      } else {
        pendentes += 1;
      }
    }
    const pagamentos = pagBySessao.get(s.id) || [];
    const valorPago = Number(pagamentos.reduce((acc, p) => acc + p.valor, 0).toFixed(2));
    const valorTotal = Number(s.valor_total);
    const valorRestante = Number(Math.max(0, valorTotal - valorPago).toFixed(2));
    return {
      id: s.id,
      mesa: s.mesa,
      mesaId: s.mesa_id,
      abertaEm: s.aberta_em,
      clienteNome: s.cliente_nome || null,
      valorTotal,
      valorPago,
      valorRestante,
      pagamentos,
      pixInformadoEm: s.pix_informado_em || null,
      pixAvisos: avisosBySessao.get(s.id) || [],
      pedidosEntregues: entregues,
      pedidosPendentes: pendentes,
      podeFechar: pendentes === 0,
    };
  });
}

/** Registra pagamento parcial (divisão de conta). Não fecha a sessão. */
async function registrarPagamento(sessaoId, body) {
  const forma = String(body.formaPagamento || body.forma_pagamento || '')
    .trim()
    .toLowerCase();
  if (!FORMAS.has(forma)) {
    throw new ErroCaixa(
      400,
      'Forma de pagamento inválida. Use: dinheiro, pix, cartao_debito ou cartao_credito'
    );
  }
  const valor = parseMoney(body.valor);
  if (valor === null || valor <= 0) {
    throw new ErroCaixa(400, 'Informe um valor de pagamento maior que zero');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT s.id, s.status, s.valor_total, m.numero AS mesa
       FROM mesa_sessoes s
       JOIN mesas m ON m.id = s.mesa_id
       WHERE s.id = $1
       FOR UPDATE`,
      [sessaoId]
    );
    const sessao = rows[0];
    if (!sessao) throw new ErroCaixa(404, 'Sessão não encontrada');
    if (sessao.status !== 'aberta') throw new ErroCaixa(409, 'Sessão já está fechada');

    const { rows: sumRows } = await client.query(
      `SELECT COALESCE(SUM(valor), 0)::float AS pago
       FROM sessao_pagamentos WHERE sessao_id = $1`,
      [sessaoId]
    );
    const jaPago = Number(sumRows[0].pago);
    const total = Number(sessao.valor_total);
    const restante = Number(Math.max(0, total - jaPago).toFixed(2));
    if (valor > restante + 0.009) {
      throw new ErroCaixa(400, `Valor maior que o restante (R$ ${restante.toFixed(2).replace('.', ',')})`);
    }

    const { rows: ins } = await client.query(
      `INSERT INTO sessao_pagamentos (sessao_id, valor, forma_pagamento)
       VALUES ($1, $2, $3)
       RETURNING id, valor, forma_pagamento, criado_em`,
      [sessaoId, valor, forma]
    );
    await client.query('COMMIT');

    const valorPago = Number((jaPago + valor).toFixed(2));
    return {
      ok: true,
      mesa: sessao.mesa,
      pagamento: {
        id: ins[0].id,
        valor: Number(ins[0].valor),
        formaPagamento: ins[0].forma_pagamento,
        criadoEm: ins[0].criado_em,
      },
      valorTotal: total,
      valorPago,
      valorRestante: Number(Math.max(0, total - valorPago).toFixed(2)),
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function fecharSessao(sessaoId, body) {
  const forma = String(body.formaPagamento || body.forma_pagamento || '')
    .trim()
    .toLowerCase();
  if (!FORMAS.has(forma)) {
    throw new ErroCaixa(
      400,
      'Forma de pagamento inválida. Use: dinheiro, pix, cartao_debito ou cartao_credito'
    );
  }

  const desconto = parseMoney(body.desconto);
  const taxaServico = parseMoney(body.taxaServico ?? body.taxa_servico);
  if (desconto === null) throw new ErroCaixa(400, 'Desconto inválido');
  if (taxaServico === null) throw new ErroCaixa(400, 'Taxa de serviço inválida');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT s.id, s.status, s.valor_total, s.mesa_id, m.numero AS mesa
       FROM mesa_sessoes s
       JOIN mesas m ON m.id = s.mesa_id
       WHERE s.id = $1
       FOR UPDATE`,
      [sessaoId]
    );
    const sessao = rows[0];
    if (!sessao) throw new ErroCaixa(404, 'Sessão não encontrada');
    if (sessao.status !== 'aberta') throw new ErroCaixa(409, 'Sessão já está fechada');

    const { rows: pendentes } = await client.query(
      `SELECT COUNT(*)::int AS n FROM pedidos
       WHERE sessao_id = $1 AND status <> 'entregue'`,
      [sessaoId]
    );
    if (pendentes[0].n > 0) {
      throw new ErroCaixa(
        409,
        `Ainda há ${pendentes[0].n} pedido(s) em andamento. Aguarde a entrega antes de fechar.`
      );
    }

    const valorTotal = Number(sessao.valor_total);
    if (desconto > valorTotal + 0.001) {
      throw new ErroCaixa(400, 'Desconto não pode ser maior que o total da conta');
    }
    const valorCobrado = Number((valorTotal - desconto + taxaServico).toFixed(2));
    if (valorCobrado < 0) throw new ErroCaixa(400, 'Valor cobrado inválido');

    const { rows: sumRows } = await client.query(
      `SELECT COALESCE(SUM(valor), 0)::float AS pago
       FROM sessao_pagamentos WHERE sessao_id = $1`,
      [sessaoId]
    );
    let valorPago = Number(sumRows[0].pago);
    const falta = Number((valorCobrado - valorPago).toFixed(2));
    if (falta > 0.009) {
      await client.query(
        `INSERT INTO sessao_pagamentos (sessao_id, valor, forma_pagamento)
         VALUES ($1, $2, $3)`,
        [sessaoId, falta, forma]
      );
      valorPago = Number((valorPago + falta).toFixed(2));
    }

    const { rows: updated } = await client.query(
      `UPDATE mesa_sessoes
       SET status = 'fechada',
           fechada_em = now(),
           forma_pagamento = $1,
           desconto = $2,
           taxa_servico = $3,
           valor_cobrado = $4
       WHERE id = $5
       RETURNING id, valor_total, desconto, taxa_servico, valor_cobrado,
                 forma_pagamento, fechada_em, aberta_em`,
      [forma, desconto, taxaServico, valorCobrado, sessaoId]
    );

    await client.query("UPDATE mesas SET status = 'livre' WHERE id = $1", [sessao.mesa_id]);
    await client.query('COMMIT');

    const row = updated[0];
    return {
      id: row.id,
      mesa: sessao.mesa,
      valorTotal: Number(row.valor_total),
      desconto: Number(row.desconto),
      taxaServico: Number(row.taxa_servico),
      valorCobrado: Number(row.valor_cobrado),
      valorPago,
      formaPagamento: row.forma_pagamento,
      abertaEm: row.aberta_em,
      fechadaEm: row.fechada_em,
      status: 'fechada',
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}


/** Caixa confirma aviso PIX do cliente → registra pagamento parcial e quita o aviso. */
async function confirmarPixAviso(sessaoId, avisoId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: sessRows } = await client.query(
      `SELECT s.id, s.status, s.valor_total, m.numero AS mesa
       FROM mesa_sessoes s
       JOIN mesas m ON m.id = s.mesa_id
       WHERE s.id = $1
       FOR UPDATE`,
      [sessaoId]
    );
    const sessao = sessRows[0];
    if (!sessao) throw new ErroCaixa(404, 'Sessão não encontrada');
    if (sessao.status !== 'aberta') throw new ErroCaixa(409, 'Sessão já está fechada');

    const { rows: avRows } = await client.query(
      `SELECT id, sessao_id, valor, status, pedido_id, cliente_nome
       FROM pix_avisos WHERE id = $1 AND sessao_id = $2
       FOR UPDATE`,
      [avisoId, sessaoId]
    );
    const aviso = avRows[0];
    if (!aviso) throw new ErroCaixa(404, 'Aviso PIX não encontrado');
    if (aviso.status !== 'pendente') {
      throw new ErroCaixa(409, 'Este aviso já foi tratado');
    }

    const valor = Number(Number(aviso.valor).toFixed(2));
    const { rows: sumRows } = await client.query(
      `SELECT COALESCE(SUM(valor), 0)::float AS pago
       FROM sessao_pagamentos WHERE sessao_id = $1`,
      [sessaoId]
    );
    const jaPago = Number(sumRows[0].pago);
    const total = Number(sessao.valor_total);
    const restante = Number(Math.max(0, total - jaPago).toFixed(2));
    if (valor > restante + 0.009) {
      throw new ErroCaixa(
        400,
        `Valor do aviso (R$ ${valor.toFixed(2).replace('.', ',')}) maior que o restante (R$ ${restante.toFixed(2).replace('.', ',')})`
      );
    }

    const { rows: ins } = await client.query(
      `INSERT INTO sessao_pagamentos (sessao_id, valor, forma_pagamento)
       VALUES ($1, $2, 'pix')
       RETURNING id, valor, forma_pagamento, criado_em`,
      [sessaoId, valor]
    );

    await client.query(
      `UPDATE pix_avisos SET status = 'confirmado', confirmado_em = now() WHERE id = $1`,
      [avisoId]
    );

    // se não há mais avisos pendentes, limpa flag da sessão
    const { rows: pend } = await client.query(
      `SELECT COUNT(*)::int AS n FROM pix_avisos WHERE sessao_id = $1 AND status = 'pendente'`,
      [sessaoId]
    );
    if (pend[0].n === 0) {
      await client.query(
        `UPDATE mesa_sessoes SET pix_informado_em = NULL WHERE id = $1`,
        [sessaoId]
      );
    }

    const valorPago = Number((jaPago + valor).toFixed(2));
    await client.query('COMMIT');
    return {
      ok: true,
      mesa: sessao.mesa,
      sessaoId,
      avisoId,
      pagamento: {
        id: ins[0].id,
        valor: Number(ins[0].valor),
        formaPagamento: ins[0].forma_pagamento,
        criadoEm: ins[0].criado_em,
      },
      valorPago,
      valorRestante: Number(Math.max(0, total - valorPago).toFixed(2)),
      clienteNome: aviso.cliente_nome || null,
      pedidoId: aviso.pedido_id,
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

module.exports = {
  listSessoesAbertas,
  registrarPagamento,
  confirmarPixAviso,
  fecharSessao,
  ErroCaixa,
  FORMAS,
};

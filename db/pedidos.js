// Criação de pedido, avanço de status, cancelar/editar (cliente) e leitura de sessão/fila.
const pool = require('./pool');
const { TRANSICOES, getMesaPorToken, getOuAbrirSessao, getProdutoComRegras } = require('./queries');

class ErroPedido extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function restaurarEstoqueDoPedido(client, pedidoId) {
  const { rows: itens } = await client.query(
    `SELECT ip.produto_id, ip.quantidade, pr.controla_estoque
     FROM itens_pedido ip
     JOIN produtos pr ON pr.id = ip.produto_id
     WHERE ip.pedido_id = $1`,
    [pedidoId]
  );
  for (const it of itens) {
    if (!it.controla_estoque) continue;
    await client.query(
      `UPDATE produtos
       SET estoque = COALESCE(estoque, 0) + $1,
           disponivel = true
       WHERE id = $2 AND controla_estoque = true`,
      [it.quantidade, it.produto_id]
    );
  }
}

async function gravarItensPedido(client, pedidoId, itensInput) {
  const itensGravados = [];
  let total = 0;

  // Limite defensivo: payload abusivo vira erro 400 em vez de loop longo dentro
  // da transação (segura lock de estoque por mais tempo do que o necessário).
  if (!Array.isArray(itensInput) || itensInput.length > 100) {
    throw new ErroPedido(400, 'Quantidade de itens do pedido inválida');
  }

  for (const item of itensInput) {
    if (!item || typeof item !== 'object') continue;
    const produtoId = Number(item.productId ?? item.id);
    if (!Number.isInteger(produtoId) || produtoId < 1) continue;
    const produto = await getProdutoComRegras(client, produtoId);
    if (!produto || !produto.disponivel) continue;

    // Fora de 1–99 é rejeitado explicitamente; antes era clamp silencioso
    // (Math.max/Math.min), que escondia cliente quebrado e teste abusivo.
    const rawQuantidade = item.qty;
    const quantidade =
      rawQuantidade === undefined || rawQuantidade === null || rawQuantidade === ''
        ? 1
        : Number(rawQuantidade);
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 99) {
      throw new ErroPedido(400, `Quantidade inválida para "${produto.nome}"`);
    }

    if (produto.controla_estoque) {
      const disp = produto.estoque == null ? 0 : Number(produto.estoque);
      if (!Number.isFinite(disp) || disp < quantidade) {
        throw new ErroPedido(400, `Estoque insuficiente para "${produto.nome}" (disponível: ${disp})`);
      }
    }

    const adicionaisSelecionados = Array.isArray(item.additions) ? item.additions.slice(0, 50) : [];
    const adicionaisValidos = [];
    for (const a of adicionaisSelecionados) {
      if (!a || typeof a !== 'object') continue;
      const adicionalId = Number(a.id);
      if (!Number.isInteger(adicionalId) || adicionalId < 1) continue;
      const permitido = produto.adicionaisPermitidos.find((x) => x.id === adicionalId);
      if (permitido) adicionaisValidos.push(permitido);
    }

    const remocoesSolicitadas = Array.isArray(item.removals) ? item.removals.slice(0, 50) : [];
    const remocoesValidas = [
      ...new Set(
        remocoesSolicitadas
          .filter((r) => typeof r === 'string')
          .map((r) => r.trim())
          .filter((r) => produto.removiveisPermitidos.includes(r))
      ),
    ];

    const pontoCarne =
      produto.pede_ponto_carne && ['MAL_PASSADO', 'AO_PONTO', 'BEM_PASSADO'].includes(item.meatPoint)
        ? item.meatPoint
        : null;

    const observacao = String(item.note || '').trim().slice(0, 300) || null;

    const { rows: itemRows } = await client.query(
      `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario, ponto_carne, observacao)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [pedidoId, produto.id, quantidade, produto.preco, pontoCarne, observacao]
    );
    const itemId = itemRows[0].id;

    for (const a of adicionaisValidos) {
      await client.query(
        `INSERT INTO itens_pedido_adicionais (item_pedido_id, adicional_id, preco_unitario)
         VALUES ($1, $2, $3)`,
        [itemId, a.id, a.preco]
      );
    }
    for (const ingrediente of remocoesValidas) {
      await client.query(
        `INSERT INTO itens_pedido_remocoes (item_pedido_id, ingrediente) VALUES ($1, $2)`,
        [itemId, ingrediente]
      );
    }

    if (produto.controla_estoque) {
      const { rowCount } = await client.query(
        `UPDATE produtos
         SET estoque = estoque - $1,
             disponivel = CASE WHEN estoque - $1 <= 0 THEN false ELSE disponivel END
         WHERE id = $2 AND controla_estoque = true AND estoque >= $1`,
        [quantidade, produto.id]
      );
      if (!rowCount) {
        throw new ErroPedido(409, `Estoque de "${produto.nome}" esgotou durante o pedido`);
      }
      produto.estoque = Number(produto.estoque) - quantidade;
    }

    const precoAdicionais = adicionaisValidos.reduce((s, a) => s + Number(a.preco), 0);
    const unitTotal = Number(produto.preco) + precoAdicionais;
    total += unitTotal * quantidade;

    itensGravados.push({
      id: itemId,
      produtoId: produto.id,
      nome: produto.nome,
      quantidade,
      precoUnitario: Number(produto.preco),
      adicionais: adicionaisValidos.map((a) => ({ id: a.id, nome: a.nome, preco: Number(a.preco) })),
      removals: remocoesValidas,
      pontoCarne,
      observacao,
      unitTotal: Number(unitTotal.toFixed(2)),
    });
  }

  if (!itensGravados.length) throw new ErroPedido(400, 'Nenhum item válido no pedido');
  return { itensGravados, total: Number(total.toFixed(2)) };
}

async function criarPedido(token, body) {
  const itensInput = Array.isArray(body.items) ? body.items : [];
  if (!itensInput.length) throw new ErroPedido(400, 'O pedido está vazio');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mesa = await getMesaPorToken(client, token);
    if (!mesa) throw new ErroPedido(404, 'Mesa não encontrada');

    const sessaoId = await getOuAbrirSessao(client, mesa.id);

    const clienteNome = String(body.clienteNome || body.cliente_nome || '')
      .trim()
      .slice(0, 80) || null;
    if (clienteNome) {
      await client.query(
        `UPDATE mesa_sessoes SET cliente_nome = COALESCE(cliente_nome, $2) WHERE id = $1`,
        [sessaoId, clienteNome]
      );
    }

    const observacaoGeral = String(body.note || '').trim().slice(0, 500) || null;
    const { rows: pedidoRows } = await client.query(
      `INSERT INTO pedidos (sessao_id, observacao_geral, cliente_nome)
       VALUES ($1, $2, $3) RETURNING id, status, criado_em, cliente_nome, editado_em`,
      [sessaoId, observacaoGeral, clienteNome]
    );
    const pedido = pedidoRows[0];

    await client.query(
      `UPDATE mesa_sessoes SET pix_informado_em = NULL WHERE id = $1`,
      [sessaoId]
    );

    const { itensGravados, total } = await gravarItensPedido(client, pedido.id, itensInput);
    if (!itensGravados.length) {
      throw new ErroPedido(400, 'Nenhum item válido no pedido (produto indisponível ou id inválido)');
    }

    await client.query('COMMIT');

    return {
      id: pedido.id,
      sessaoId,
      mesa: mesa.numero,
      status: pedido.status,
      criadoEm: pedido.criado_em,
      editadoEm: pedido.editado_em || null,
      clienteNome: pedido.cliente_nome || clienteNome,
      observacaoGeral,
      itens: itensGravados,
      total,
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

/** Cliente cancela pedido só enquanto status = recebido (ainda não em preparo). */
async function cancelarPedidoCliente(token, pedidoId) {
  const pedidoNumerico = Number(pedidoId);
  if (!Number.isInteger(pedidoNumerico) || pedidoNumerico < 1) {
    throw new ErroPedido(400, 'Pedido inválido');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mesa = await getMesaPorToken(client, token);
    if (!mesa) throw new ErroPedido(404, 'Mesa não encontrada');

    const { rows } = await client.query(
      `SELECT p.id, p.status, p.sessao_id
       FROM pedidos p
       JOIN mesa_sessoes s ON s.id = p.sessao_id
       WHERE p.id = $1 AND s.mesa_id = $2 AND s.status = 'aberta'
       FOR UPDATE OF p`,
      [Number(pedidoId), mesa.id]
    );
    const pedido = rows[0];
    if (!pedido) throw new ErroPedido(404, 'Pedido não encontrado nesta mesa');
    if (pedido.status !== 'recebido') {
      throw new ErroPedido(
        409,
        'Só é possível cancelar enquanto o pedido ainda não entrou em preparo na cozinha'
      );
    }

    await restaurarEstoqueDoPedido(client, pedido.id);

    await client.query(
      `DELETE FROM itens_pedido_adicionais
       WHERE item_pedido_id IN (SELECT id FROM itens_pedido WHERE pedido_id = $1)`,
      [pedido.id]
    );
    await client.query(
      `DELETE FROM itens_pedido_remocoes
       WHERE item_pedido_id IN (SELECT id FROM itens_pedido WHERE pedido_id = $1)`,
      [pedido.id]
    );
    await client.query(`DELETE FROM itens_pedido WHERE pedido_id = $1`, [pedido.id]);
    await client.query(`DELETE FROM pedidos WHERE id = $1`, [pedido.id]);

    await client.query('COMMIT');
    return { ok: true, id: pedido.id, cancelado: true, mesa: mesa.numero };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

/** Cliente edita itens do pedido só enquanto status = recebido. Marca editado_em. */
async function editarPedidoCliente(token, pedidoId, body) {
  const itensInput = Array.isArray(body.items) ? body.items : [];
  if (!itensInput.length) throw new ErroPedido(400, 'O pedido editado está vazio — cancele se quiser remover');
  const pedidoNumerico = Number(pedidoId);
  if (!Number.isInteger(pedidoNumerico) || pedidoNumerico < 1) {
    throw new ErroPedido(400, 'Pedido inválido');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mesa = await getMesaPorToken(client, token);
    if (!mesa) throw new ErroPedido(404, 'Mesa não encontrada');

    const { rows } = await client.query(
      `SELECT p.id, p.status, p.sessao_id, p.cliente_nome, p.observacao_geral
       FROM pedidos p
       JOIN mesa_sessoes s ON s.id = p.sessao_id
       WHERE p.id = $1 AND s.mesa_id = $2 AND s.status = 'aberta'
       FOR UPDATE OF p`,
      [Number(pedidoId), mesa.id]
    );
    const pedido = rows[0];
    if (!pedido) throw new ErroPedido(404, 'Pedido não encontrado nesta mesa');
    if (pedido.status !== 'recebido') {
      throw new ErroPedido(
        409,
        'Só é possível editar enquanto o pedido ainda não entrou em preparo na cozinha'
      );
    }

    await restaurarEstoqueDoPedido(client, pedido.id);

    await client.query(
      `DELETE FROM itens_pedido_adicionais
       WHERE item_pedido_id IN (SELECT id FROM itens_pedido WHERE pedido_id = $1)`,
      [pedido.id]
    );
    await client.query(
      `DELETE FROM itens_pedido_remocoes
       WHERE item_pedido_id IN (SELECT id FROM itens_pedido WHERE pedido_id = $1)`,
      [pedido.id]
    );
    await client.query(`DELETE FROM itens_pedido WHERE pedido_id = $1`, [pedido.id]);

    const observacaoGeral =
      body.note !== undefined
        ? String(body.note || '').trim().slice(0, 500) || null
        : pedido.observacao_geral;

    const { itensGravados, total } = await gravarItensPedido(client, pedido.id, itensInput);

    const { rows: updated } = await client.query(
      `UPDATE pedidos
       SET editado_em = now(),
           observacao_geral = $2
       WHERE id = $1
       RETURNING id, status, criado_em, editado_em, cliente_nome, observacao_geral`,
      [pedido.id, observacaoGeral]
    );

    await client.query('COMMIT');

    return {
      id: updated[0].id,
      status: updated[0].status,
      criadoEm: updated[0].criado_em,
      editadoEm: updated[0].editado_em,
      clienteNome: updated[0].cliente_nome,
      observacaoGeral: updated[0].observacao_geral,
      mesa: mesa.numero,
      itens: itensGravados,
      total,
      editado: true,
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
/** Avança o pedido para o próximo status do fluxo (TRANSICOES). Usado pela cozinha/bar. */
async function avancarStatusItem(pedidoId, setor = null) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id < 1) throw new ErroPedido(400, 'Pedido inválido');
  const { rows } = await pool.query(`SELECT status FROM pedidos WHERE id = $1`, [id]);
  const pedido = rows[0];
  if (!pedido) throw new ErroPedido(404, 'Pedido não encontrado');
  const proximo = TRANSICOES[pedido.status];
  if (!proximo) {
    throw new ErroPedido(409, `Pedido em status "${pedido.status}" não pode avançar`);
  }
  return setStatusPedido(pedidoId, proximo, setor);
}

async function getSessao(token) {
  const client = await pool.connect();
  try {
    const mesa = await getMesaPorToken(client, token);
    if (!mesa) throw new ErroPedido(404, 'Mesa não encontrada');

    const { rows: sessaoRows } = await client.query(
      "SELECT id, aberta_em, cliente_nome, pix_informado_em FROM mesa_sessoes WHERE mesa_id = $1 AND status = 'aberta'",
      [mesa.id]
    );
    const sessao = sessaoRows[0];
    if (!sessao)
      return { mesa: mesa.numero, sessaoAberta: false, pedidos: [], totalDevido: 0, clienteNome: null };

    const { rows: pedidos } = await client.query(
      `SELECT id, status, criado_em, observacao_geral, cliente_nome, garcom_nome, claimed_at, editado_em
       FROM pedidos
       WHERE sessao_id = $1 ORDER BY criado_em`,
      [sessao.id]
    );
    if (!pedidos.length) {
      return {
        mesa: mesa.numero,
        sessaoAberta: true,
        sessaoId: sessao.id,
        abertaEm: sessao.aberta_em,
        clienteNome: sessao.cliente_nome || null,
        pixInformadoEm: sessao.pix_informado_em || null,
        pixAvisos: [],
        pedidos: [],
        totalDevido: 0,
        valorPago: 0,
        valorRestante: 0,
      };
    }

    const ids = pedidos.map((p) => p.id);
    const { rows: itensRows } = await client.query(
      `SELECT ip.id, ip.pedido_id, pr.nome, ip.quantidade, ip.preco_unitario, ip.ponto_carne, ip.observacao, ip.produto_id,
              COALESCE(ip.status, 'recebido') AS status,
              COALESCE(pr.setor, 'cozinha') AS setor
       FROM itens_pedido ip
       JOIN produtos pr ON pr.id = ip.produto_id
       WHERE ip.pedido_id = ANY($1::int[])
       ORDER BY ip.id`,
      [ids]
    );

    const itemIds = itensRows.map((i) => i.id);
    let adRows = [];
    let remRows = [];
    if (itemIds.length) {
      const [adRes, remRes] = await Promise.all([
        client.query(
          `SELECT ipa.item_pedido_id, a.id AS adicional_id, a.nome, ipa.preco_unitario
           FROM itens_pedido_adicionais ipa
           JOIN adicionais a ON a.id = ipa.adicional_id
           WHERE ipa.item_pedido_id = ANY($1::int[])`,
          [itemIds]
        ),
        client.query(
          `SELECT item_pedido_id, ingrediente
           FROM itens_pedido_remocoes
           WHERE item_pedido_id = ANY($1::int[])`,
          [itemIds]
        ),
      ]);
      adRows = adRes.rows;
      remRows = remRes.rows;
    }

    const addByItem = new Map();
    for (const a of adRows) {
      if (!addByItem.has(a.item_pedido_id)) addByItem.set(a.item_pedido_id, []);
      addByItem.get(a.item_pedido_id).push({
        id: a.adicional_id,
        nome: a.nome,
        preco: Number(a.preco_unitario),
      });
    }
    const remByItem = new Map();
    for (const r of remRows) {
      if (!remByItem.has(r.item_pedido_id)) remByItem.set(r.item_pedido_id, []);
      remByItem.get(r.item_pedido_id).push(r.ingrediente);
    }

    const itensByPedido = new Map();
    for (const item of itensRows) {
      const adicionais = addByItem.get(item.id) || [];
      const remocoes = remByItem.get(item.id) || [];
      const totalAdicionais = adicionais.reduce((sum, a) => sum + a.preco, 0);
      const linha = (Number(item.preco_unitario) + totalAdicionais) * item.quantidade;
      const packed = {
        id: item.id,
        produtoId: item.produto_id,
        nome: item.nome,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        ponto_carne: item.ponto_carne,
        observacao: item.observacao,
        status: item.status || 'recebido',
        setor: item.setor || 'cozinha',
        adicionais,
        remocoes,
        totalLinha: Number(linha.toFixed(2)),
      };
      if (!itensByPedido.has(item.pedido_id)) itensByPedido.set(item.pedido_id, []);
      itensByPedido.get(item.pedido_id).push(packed);
    }

    let totalDevido = 0;
    const pedidosComItens = pedidos.map((p) => {
      const itens = itensByPedido.get(p.id) || [];
      const totalPedido = itens.reduce((sum, i) => sum + i.totalLinha, 0);
      // Conta na conta o que já foi ENTREGUE (parcial ou total)
      for (const i of itens) {
        if (i.status === 'entregue') totalDevido += i.totalLinha;
      }
      return {
        ...p,
        editadoEm: p.editado_em || null,
        itens,
        totalPedido: Number(totalPedido.toFixed(2)),
        podeEditar: p.status === 'recebido',
      };
    });
    totalDevido = Number(totalDevido.toFixed(2));

    const { rows: pagRows } = await client.query(
      `SELECT COALESCE(SUM(valor), 0)::float AS pago
       FROM sessao_pagamentos WHERE sessao_id = $1`,
      [sessao.id]
    );
    const valorPago = Number(Number(pagRows[0].pago || 0).toFixed(2));
    const valorRestante = Number(Math.max(0, totalDevido - valorPago).toFixed(2));

    const { rows: avisoRows } = await client.query(
      `SELECT id, pedido_id, valor, cliente_nome, status, criado_em, confirmado_em
       FROM pix_avisos
       WHERE sessao_id = $1 AND status = 'pendente'
       ORDER BY criado_em DESC`,
      [sessao.id]
    );
    const pixAvisos = avisoRows.map(function (a) {
      return {
        id: a.id,
        pedidoId: a.pedido_id,
        valor: Number(a.valor),
        clienteNome: a.cliente_nome || null,
        status: a.status,
        criadoEm: a.criado_em,
        confirmadoEm: a.confirmado_em || null,
      };
    });

    return {
      mesa: mesa.numero,
      sessaoAberta: true,
      sessaoId: sessao.id,
      abertaEm: sessao.aberta_em,
      clienteNome: sessao.cliente_nome || null,
      pixInformadoEm: sessao.pix_informado_em || null,
      pixAvisos: pixAvisos,
      pedidos: pedidosComItens,
      totalDevido,
      valorPago,
      valorRestante,
    };
  } finally {
    client.release();
  }
}

async function anexarExtrasAosItens(itens) {
  if (!itens.length) return itens;
  const itemIds = itens.map((i) => i.id);
  const [adRes, remRes] = await Promise.all([
    pool.query(
      `SELECT ipa.item_pedido_id, a.nome
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
  const addByItem = new Map();
  for (const a of adRes.rows) {
    if (!addByItem.has(a.item_pedido_id)) addByItem.set(a.item_pedido_id, []);
    addByItem.get(a.item_pedido_id).push({ nome: a.nome });
  }
  const remByItem = new Map();
  for (const r of remRes.rows) {
    if (!remByItem.has(r.item_pedido_id)) remByItem.set(r.item_pedido_id, []);
    remByItem.get(r.item_pedido_id).push(r.ingrediente);
  }
  for (const item of itens) {
    item.adicionais = addByItem.get(item.id) || [];
    item.remocoes = remByItem.get(item.id) || [];
  }
  return itens;
}

/** Lista pedidos com itens, opcionalmente filtrados por setor de produção (cozinha|bar). */
async function listarPedidosPorStatus(statuses, setor = null) {
  let pedidos;
  if (setor) {
    // Só pedidos com trabalho pendente neste setor (recebido/em_producao).
    // Itens já "concluido" saem da fila da cozinha/bar e vão para o garçom.
    // Isso evita o card "zumbi" e o flicker de sumir/voltar quando o último item do setor fica pronto.
    const { rows } = await pool.query(
      `SELECT DISTINCT p.id, p.status, p.criado_em, p.observacao_geral, p.cliente_nome, p.garcom_nome,
              p.editado_em, m.numero AS mesa
       FROM pedidos p
       JOIN mesa_sessoes s ON s.id = p.sessao_id
       JOIN mesas m ON m.id = s.mesa_id
       JOIN itens_pedido ip ON ip.pedido_id = p.id
       JOIN produtos pr ON pr.id = ip.produto_id
       WHERE p.status = ANY($1::text[])
         AND COALESCE(pr.setor, 'cozinha') = $2
         AND p.status <> 'entregue'
         AND COALESCE(ip.status, 'recebido') IN ('recebido', 'em_producao')
       ORDER BY p.criado_em`,
      [statuses, setor]
    );
    pedidos = rows;
  } else {
    const { rows } = await pool.query(
      `SELECT p.id, p.status, p.criado_em, p.observacao_geral, p.cliente_nome, p.garcom_nome,
              p.editado_em, m.numero AS mesa
       FROM pedidos p
       JOIN mesa_sessoes s ON s.id = p.sessao_id
       JOIN mesas m ON m.id = s.mesa_id
       WHERE p.status = ANY($1::text[])
       ORDER BY p.criado_em`,
      [statuses]
    );
    pedidos = rows;
  }
  if (!pedidos.length) return [];

  const ids = pedidos.map((p) => p.id);
  let itensRows;
  if (setor) {
    const { rows } = await pool.query(
      `SELECT ip.id, ip.pedido_id, pr.nome, ip.quantidade, ip.ponto_carne, ip.observacao,
              COALESCE(ip.status, 'recebido') AS status,
              COALESCE(pr.setor, 'cozinha') AS setor
       FROM itens_pedido ip
       JOIN produtos pr ON pr.id = ip.produto_id
       WHERE ip.pedido_id = ANY($1::int[])
         AND COALESCE(pr.setor, 'cozinha') = $2
         AND COALESCE(ip.status, 'recebido') <> 'entregue'
       ORDER BY ip.id`,
      [ids, setor]
    );
    itensRows = rows;
  } else {
    const { rows } = await pool.query(
      `SELECT ip.id, ip.pedido_id, pr.nome, ip.quantidade, ip.ponto_carne, ip.observacao,
              COALESCE(ip.status, 'recebido') AS status,
              COALESCE(pr.setor, 'cozinha') AS setor
       FROM itens_pedido ip
       JOIN produtos pr ON pr.id = ip.produto_id
       WHERE ip.pedido_id = ANY($1::int[])
       ORDER BY ip.id`,
      [ids]
    );
    itensRows = rows;
  }
  await anexarExtrasAosItens(itensRows);

  const byPedido = new Map();
  for (const item of itensRows) {
    if (!byPedido.has(item.pedido_id)) byPedido.set(item.pedido_id, []);
    byPedido.get(item.pedido_id).push(item);
  }

  // Status agregado do setor: o card da cozinha/bar segue o "pior" status dos itens do setor
  return pedidos
    .map((p) => {
      const itens = byPedido.get(p.id) || [];
      if (setor && !itens.length) return null;
      let statusSetor = p.status;
      if (setor && itens.length) {
        const st = itens.map((i) => i.status || 'recebido');
        if (st.every((s) => s === 'concluido')) statusSetor = 'concluido';
        else if (st.some((s) => s === 'em_producao' || s === 'concluido')) statusSetor = 'em_producao';
        else statusSetor = 'recebido';
      }
      return {
        ...p,
        status: statusSetor,
        editadoEm: p.editado_em || null,
        itens,
      };
    })
    .filter(Boolean);
}

async function getFilaCozinha() {
  return listarPedidosPorStatus(['recebido', 'em_producao', 'concluido'], 'cozinha');
}

async function getFilaGarcom() {
  /* Pedidos com pelo menos um item PRONTO (concluido) aguardando entrega parcial ou total */
  const { rows: pedidos } = await pool.query(
    `SELECT DISTINCT p.id, p.status, p.criado_em, p.observacao_geral, p.cliente_nome, p.garcom_nome,
            p.editado_em, m.numero AS mesa
     FROM pedidos p
     JOIN mesa_sessoes s ON s.id = p.sessao_id
     JOIN mesas m ON m.id = s.mesa_id
     JOIN itens_pedido ip ON ip.pedido_id = p.id
     WHERE p.status <> 'entregue'
       AND COALESCE(ip.status, 'recebido') = 'concluido'
     ORDER BY p.criado_em`
  );
  if (!pedidos.length) return [];

  const ids = pedidos.map((p) => p.id);
  const { rows: itensRows } = await pool.query(
    `SELECT ip.id, ip.pedido_id, pr.nome, ip.quantidade, ip.ponto_carne, ip.observacao,
            COALESCE(ip.status, 'recebido') AS status,
            COALESCE(pr.setor, 'cozinha') AS setor
     FROM itens_pedido ip
     JOIN produtos pr ON pr.id = ip.produto_id
     WHERE ip.pedido_id = ANY($1::int[])
     ORDER BY ip.id`,
    [ids]
  );
  await anexarExtrasAosItens(itensRows);

  const byPedido = new Map();
  for (const item of itensRows) {
    if (!byPedido.has(item.pedido_id)) byPedido.set(item.pedido_id, []);
    byPedido.get(item.pedido_id).push(item);
  }

  return pedidos.map((p) => {
    const itens = byPedido.get(p.id) || [];
    const prontos = itens.filter((i) => i.status === 'concluido');
    return {
      ...p,
      /* status UI "concluido" enquanto houver algo pra levar */
      status: 'concluido',
      editadoEm: p.editado_em || null,
      itens,
      itensProntos: prontos.length,
      itensPendentesProducao: itens.filter((i) =>
        i.status === 'recebido' || i.status === 'em_producao'
      ).length,
    };
  });
}

async function getFilaBar() {
  return listarPedidosPorStatus(['recebido', 'em_producao', 'concluido'], 'bar');
}

const ITEM_TRANSICOES = Object.freeze({
  recebido: 'em_producao',
  em_producao: 'concluido',
});

/** Sincroniza status do pedido-pai a partir dos itens. */
async function sincronizarStatusPedido(client, pedidoId) {
  const { rows } = await client.query(
    `SELECT COALESCE(status, 'recebido') AS status FROM itens_pedido WHERE pedido_id = $1`,
    [pedidoId]
  );
  if (!rows.length) return null;
  const statuses = rows.map((r) => r.status);
  const allEntregue = statuses.every((s) => s === 'entregue');
  const allProntosOuEntregues = statuses.every((s) => s === 'concluido' || s === 'entregue');
  const anyAvancado = statuses.some((s) =>
    s === 'em_producao' || s === 'concluido' || s === 'entregue'
  );
  let novo = 'recebido';
  if (allEntregue) novo = 'entregue';
  else if (allProntosOuEntregues) novo = 'concluido';
  else if (anyAvancado) novo = 'em_producao';

  const { rows: updated } = await client.query(
    `UPDATE pedidos SET status = $2 WHERE id = $1
     RETURNING id, status, criado_em, editado_em, cliente_nome, sessao_id`,
    [pedidoId, novo]
  );
  return updated[0] || null;
}

/**
 * Avança status de UM item (usado por /api/cozinha|bar/itens/:id/status).
 * setorAuth: 'cozinha' | 'bar' | null (admin) — valida o setor do produto.
 */
async function setStatusItem(itemId, statusAlvo, setorAuth = null) {
  const alvo = String(statusAlvo || '').trim();
  if (!['recebido', 'em_producao', 'concluido'].includes(alvo)) {
    throw new ErroPedido(400, 'Status de item inválido');
  }
  const id = Number(itemId);
  if (!Number.isInteger(id) || id < 1) throw new ErroPedido(400, 'Item inválido');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT ip.id, ip.pedido_id, COALESCE(ip.status, 'recebido') AS status,
              COALESCE(pr.setor, 'cozinha') AS setor, p.status AS pedido_status
       FROM itens_pedido ip
       JOIN produtos pr ON pr.id = ip.produto_id
       JOIN pedidos p ON p.id = ip.pedido_id
       WHERE ip.id = $1
       FOR UPDATE OF ip`,
      [Number(itemId)]
    );
    const item = rows[0];
    if (!item) throw new ErroPedido(404, 'Item não encontrado');
    if (item.pedido_status === 'entregue') {
      throw new ErroPedido(409, 'Pedido já entregue');
    }
    if (setorAuth && item.setor !== setorAuth) {
      throw new ErroPedido(403, `Item pertence ao setor ${item.setor}`);
    }

    // Idempotente + só permite avanço linear (ou manter o mesmo status)
    const esperado = ITEM_TRANSICOES[item.status];
    if (alvo !== item.status && alvo !== esperado) {
      // Ainda permite atalho recebido → concluido (cozinha rápida), mas nada de regressão
      if (!(item.status === 'recebido' && alvo === 'concluido')) {
        throw new ErroPedido(
          409,
          `Item em "${item.status}" não pode ir para "${alvo}" (esperado: ${esperado || "nenhum"})`
        );
      }
    }
    // Impede regressão (ex.: concluido → recebido)
    const ordem = { recebido: 0, em_producao: 1, concluido: 2, entregue: 3 };
    if ((ordem[alvo] ?? -1) < (ordem[item.status] ?? 0) && alvo !== item.status) {
      throw new ErroPedido(409, `Não é permitido regredir status de item de "${item.status}" para "${alvo}"`);
    }

    await client.query(`UPDATE itens_pedido SET status = $2 WHERE id = $1`, [item.id, alvo]);
    const pedido = await sincronizarStatusPedido(client, item.pedido_id);
    await client.query('COMMIT');
    return {
      itemId: item.id,
      status: alvo,
      statusAnterior: item.status,
      setor: item.setor,
      pedidoId: item.pedido_id,
      pedidoStatus: pedido ? pedido.status : item.pedido_status,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Define status do pedido (React Cozinha/Bar: PATCH /api/pedidos/:id/status).
 * Se setor for informado, só avança itens daquele setor; o pedido-pai é recalculado.
 */
async function setStatusPedido(pedidoId, statusAlvo, setor = null) {
  const alvo = String(statusAlvo || '').trim();
  if (!['recebido', 'em_producao', 'concluido', 'entregue'].includes(alvo)) {
    throw new ErroPedido(400, 'Status inválido');
  }
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id < 1) throw new ErroPedido(400, 'Pedido inválido');

  // ADR-007: entrega é operação do fluxo do garçom. Cozinha/bar chegam aqui com
  // setor='cozinha'/'bar'; só chamada administrativa (sem setor) pode usar esta
  // transição como override. Sem a guarda, um PATCH da cozinha quitava o pedido
  // inteiro e o caixa fechava conta sem ninguém levar a comida.
  if (alvo === 'entregue' && setor) {
    throw new ErroPedido(403, 'Entrega deve ser registrada pelo garçom');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, sessao_id FROM pedidos WHERE id = $1 FOR UPDATE`,
      [Number(pedidoId)]
    );
    const pedido = rows[0];
    if (!pedido) throw new ErroPedido(404, 'Pedido não encontrado');
    if (pedido.status === 'entregue' && alvo !== 'entregue') {
      throw new ErroPedido(409, 'Pedido já entregue');
    }

    if (alvo === 'entregue') {
      // entrega fecha todos os itens
      await client.query(
        `UPDATE itens_pedido SET status = 'entregue' WHERE pedido_id = $1`,
        [pedido.id]
      );
      const { rows: updated } = await client.query(
        `UPDATE pedidos SET status = 'entregue' WHERE id = $1
         RETURNING id, status, criado_em, editado_em, cliente_nome, sessao_id`,
        [pedido.id]
      );
      await client.query('COMMIT');
      return { ...updated[0], statusAnterior: pedido.status };
    }

    // Conta quantos itens pertencem ao setor pedido (se houver filtro)
    let setorEfetivo = setor;
    if (setor) {
      const { rows: cnt } = await client.query(
        `SELECT COUNT(*)::int AS n
         FROM itens_pedido ip
         JOIN produtos pr ON pr.id = ip.produto_id
         WHERE ip.pedido_id = $1
           AND COALESCE(pr.setor, 'cozinha') = $2`,
        [pedido.id, setor]
      );
      // Se o pedido não tem NENHUM item deste setor (ex.: só bebida e quem
      // chamou foi a cozinha), avança TODOS os itens — evita 200 "mentiroso"
      // e o 409 posterior no garçom.
      if (!cnt[0] || cnt[0].n === 0) {
        setorEfetivo = null;
      }
    }

    let rowCount = 0;
    if (setorEfetivo) {
      if (alvo === 'em_producao') {
        const r = await client.query(
          `UPDATE itens_pedido ip
           SET status = 'em_producao'
           FROM produtos pr
           WHERE ip.produto_id = pr.id
             AND ip.pedido_id = $1
             AND COALESCE(pr.setor, 'cozinha') = $2
             AND COALESCE(ip.status, 'recebido') = 'recebido'`,
          [pedido.id, setorEfetivo]
        );
        rowCount = r.rowCount || 0;
      } else if (alvo === 'concluido') {
        const r = await client.query(
          `UPDATE itens_pedido ip
           SET status = 'concluido'
           FROM produtos pr
           WHERE ip.produto_id = pr.id
             AND ip.pedido_id = $1
             AND COALESCE(pr.setor, 'cozinha') = $2
             AND COALESCE(ip.status, 'recebido') IN ('recebido', 'em_producao')`,
          [pedido.id, setorEfetivo]
        );
        rowCount = r.rowCount || 0;
      } else if (alvo === 'recebido') {
        const r = await client.query(
          `UPDATE itens_pedido ip
           SET status = 'recebido'
           FROM produtos pr
           WHERE ip.produto_id = pr.id
             AND ip.pedido_id = $1
             AND COALESCE(pr.setor, 'cozinha') = $2`,
          [pedido.id, setorEfetivo]
        );
        rowCount = r.rowCount || 0;
      }
    } else {
      // Sem filtro de setor (ou fallback): avança todos os itens do pedido
      const r = await client.query(
        `UPDATE itens_pedido SET status = $2 WHERE pedido_id = $1`,
        [pedido.id, alvo]
      );
      rowCount = r.rowCount || 0;
    }

    const atualizado = await sincronizarStatusPedido(client, pedido.id);
    await client.query('COMMIT');
    return {
      ...(atualizado || { id: pedido.id, status: pedido.status }),
      statusAnterior: pedido.status,
      itensAtualizados: rowCount,
      setorAplicado: setorEfetivo,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function checkinCliente(token, body) {
  const nome = String(body.clienteNome || body.cliente_nome || body.nome || '')
    .trim()
    .slice(0, 80);
  if (!nome) throw new ErroPedido(400, 'Informe um nome');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mesa = await getMesaPorToken(client, token);
    if (!mesa) throw new ErroPedido(404, 'Mesa não encontrada');
    const sessaoId = await getOuAbrirSessao(client, mesa.id);
    await client.query(`UPDATE mesa_sessoes SET cliente_nome = $2 WHERE id = $1`, [sessaoId, nome]);
    await client.query('COMMIT');
    return { ok: true, mesa: mesa.numero, sessaoId, clienteNome: nome };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  criarPedido,
  avancarStatusItem,
  setStatusItem,
  setStatusPedido,
  sincronizarStatusPedido,
  getSessao,
  getFilaCozinha,
  getFilaBar,
  getFilaGarcom,
  checkinCliente,
  cancelarPedidoCliente,
  editarPedidoCliente,
  ErroPedido,
};

// CRUD de cardápio e listagem de mesas para o painel admin.
const pool = require('./pool');
const { numeroFinito, numeroInteiroPositivo } = require('./validacao');

function normalizeFotoUrl(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  // data-URL (foto otimizada no Postgres — sobrevive a redeploy)
  if (/^data:image\/(webp|jpeg|jpg|png|gif);base64,/i.test(s)) {
    if (s.length > 550000) {
      throw new ErroAdmin(413, 'Foto em base64 muito grande (máx ~400 KB otimizado)');
    }
    return s;
  }
  if (s.startsWith('/') && !s.startsWith('//')) return s.slice(0, 500);
  if (/^https?:\/\//i.test(s)) return s.slice(0, 2000);
  throw new ErroAdmin(
    400,
    'URL da foto inválida (use upload no admin, https://… ou /caminho)'
  );
}

class ErroAdmin extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function listMesas() {
  const { rows } = await pool.query(
    `SELECT m.id, m.numero, m.token, m.status,
            s.id AS sessao_id, s.valor_total, s.aberta_em, s.cliente_nome
     FROM mesas m
     LEFT JOIN mesa_sessoes s ON s.mesa_id = m.id AND s.status = 'aberta'
     ORDER BY m.numero`
  );
  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    token: r.token,
    status: r.sessao_id ? 'ocupada' : r.status,
    sessaoAberta: Boolean(r.sessao_id),
    sessaoId: r.sessao_id || null,
    valorTotal: r.valor_total != null ? Number(r.valor_total) : null,
    abertaEm: r.aberta_em || null,
    clienteNome: r.cliente_nome || null,
  }));
}

function mapProdutoRow(p) {
  return {
    id: p.id,
    categoriaId: p.categoria_id,
    nome: p.nome,
    descricao: p.descricao,
    preco: Number(p.preco),
    fotoUrl: p.foto_url,
    disponivel: p.disponivel,
    pedePontoCarne: p.pede_ponto_carne,
    setor: p.setor === 'bar' ? 'bar' : 'cozinha',
    controlaEstoque: Boolean(p.controla_estoque),
    estoque: p.estoque != null ? Number(p.estoque) : null,
    estoqueMinimo: Number(p.estoque_minimo || 0),
    estoqueBaixo: Boolean(p.controla_estoque) && p.estoque != null && Number(p.estoque) <= Number(p.estoque_minimo || 0),
    ordem: p.ordem != null ? Number(p.ordem) : 0,
  };
}

async function getCardapioAdmin() {
  const { rows: categorias } = await pool.query(
    'SELECT id, nome, ordem FROM categorias ORDER BY ordem, id'
  );
  let produtos;
  try {
    ({ rows: produtos } = await pool.query(
      `SELECT id, categoria_id, nome, descricao, preco, foto_url, disponivel, pede_ponto_carne,
              controla_estoque, estoque, estoque_minimo, ordem, setor
       FROM produtos ORDER BY ordem ASC NULLS LAST, id ASC`
    ));
  } catch (e) {
    /* migration 0012/0013 ainda não aplicada — tenta sem ordem/setor */
    try {
      ({ rows: produtos } = await pool.query(
        `SELECT id, categoria_id, nome, descricao, preco, foto_url, disponivel, pede_ponto_carne,
                controla_estoque, estoque, estoque_minimo, ordem
         FROM produtos ORDER BY ordem ASC NULLS LAST, id ASC`
      ));
    } catch (e2) {
      ({ rows: produtos } = await pool.query(
        `SELECT id, categoria_id, nome, descricao, preco, foto_url, disponivel, pede_ponto_carne,
                controla_estoque, estoque, estoque_minimo
         FROM produtos ORDER BY id ASC`
      ));
    }
  }
  const { rows: adicionais } = await pool.query(
    'SELECT id, produto_id, nome, preco FROM adicionais ORDER BY id'
  );
  const { rows: removiveis } = await pool.query(
    'SELECT produto_id, ingrediente FROM produtos_ingredientes_removiveis ORDER BY produto_id, ingrediente'
  );

  return categorias.map((cat) => ({
    id: cat.id,
    nome: cat.nome,
    ordem: cat.ordem,
    produtos: produtos
      .filter((p) => p.categoria_id === cat.id)
      .map((p) => ({
        ...mapProdutoRow(p),
        adicionais: adicionais
          .filter((a) => a.produto_id === p.id)
          .map((a) => ({ id: a.id, nome: a.nome, preco: Number(a.preco) })),
        removiveis: removiveis
          .filter((r) => r.produto_id === p.id)
          .map((r) => r.ingrediente),
      })),
  }));
}

async function criarCategoria({ nome, ordem = 0 }) {
  const n = String(nome || '').trim();
  if (!n) throw new ErroAdmin(400, 'Nome da categoria é obrigatório');
  const ordemNumero = numeroFinito(ordem, 'ordem', { inteiro: true, minimo: 0 });
  const { rows } = await pool.query(
    'INSERT INTO categorias (nome, ordem) VALUES ($1, $2) RETURNING id, nome, ordem',
    [n, ordemNumero]
  );
  return rows[0];
}

async function atualizarCategoria(id, { nome, ordem }) {
  const campos = [];
  const vals = [];
  let i = 1;
  if (nome !== undefined) {
    const n = String(nome).trim();
    if (!n) throw new ErroAdmin(400, 'Nome da categoria não pode ser vazio');
    campos.push(`nome = $${i++}`);
    vals.push(n);
  }
  if (ordem !== undefined) {
    const ordemNumero = numeroFinito(ordem, 'ordem', { inteiro: true, minimo: 0 });
    campos.push(`ordem = $${i++}`);
    vals.push(ordemNumero);
  }
  if (!campos.length) throw new ErroAdmin(400, 'Nada para atualizar');
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE categorias SET ${campos.join(', ')} WHERE id = $${i} RETURNING id, nome, ordem`,
    vals
  );
  if (!rows[0]) throw new ErroAdmin(404, 'Categoria não encontrada');
  return rows[0];
}

async function criarProduto(body) {
  const nome = String(body.nome || '').trim();
  const categoriaId = numeroInteiroPositivo(body.categoriaId, 'categoriaId');
  const preco = numeroFinito(body.preco, 'Preço', { minimo: 0 });
  const estoque = body.estoque != null && body.estoque !== ''
    ? numeroFinito(body.estoque, 'Estoque', { inteiro: true, minimo: 0 })
    : null;
  const estoqueMinimo = numeroFinito(
    body.estoqueMinimo ?? body.estoque_minimo ?? 0,
    'Estoque mínimo',
    { inteiro: true, minimo: 0 }
  );
  if (!nome) throw new ErroAdmin(400, 'Nome do produto é obrigatório');

  let setor = body.setor != null ? String(body.setor).trim() : null;
  if (setor && !['cozinha', 'bar'].includes(setor)) {
    throw new ErroAdmin(400, "setor precisa ser 'cozinha' ou 'bar'");
  }
  if (!setor) {
    // default inteligente pela categoria
    const { rows: catRows } = await pool.query('SELECT nome FROM categorias WHERE id = $1', [categoriaId]);
    const catNome = (catRows[0] && catRows[0].nome) || '';
    const n = String(catNome).toLowerCase();
    setor =
      n.includes('bebida') ||
      n.includes('suco') ||
      n.includes('drink') ||
      n.includes('cerveja') ||
      n.includes('chopp') ||
      n.includes('bar')
        ? 'bar'
        : 'cozinha';
  }

  const { rows } = await pool.query(
    `INSERT INTO produtos (categoria_id, nome, descricao, preco, foto_url, disponivel, pede_ponto_carne, controla_estoque, estoque, estoque_minimo, setor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, categoria_id, nome, descricao, preco, foto_url, disponivel, pede_ponto_carne, controla_estoque, estoque, estoque_minimo, setor`,
    [
      categoriaId,
      nome,
      body.descricao ? String(body.descricao).trim() : null,
      preco,
      normalizeFotoUrl(body.fotoUrl ?? null),
      body.disponivel !== false,
      Boolean(body.pedePontoCarne),
      Boolean(body.controlaEstoque || body.controla_estoque),
      estoque,
      estoqueMinimo,
      setor,
    ]
  );
  return { ...mapProdutoRow(rows[0]), adicionais: [], removiveis: [] };
}

async function atualizarProduto(id, body) {
  const campos = [];
  const vals = [];
  let i = 1;

  if (body.nome !== undefined) {
    const n = String(body.nome).trim();
    if (!n) throw new ErroAdmin(400, 'Nome não pode ser vazio');
    campos.push(`nome = $${i++}`);
    vals.push(n);
  }
  if (body.descricao !== undefined) {
    campos.push(`descricao = $${i++}`);
    vals.push(body.descricao ? String(body.descricao).trim() : null);
  }
  if (body.preco !== undefined) {
    const preco = numeroFinito(body.preco, 'Preço', { minimo: 0 });
    campos.push(`preco = $${i++}`);
    vals.push(preco);
  }
  if (body.fotoUrl !== undefined) {
    campos.push(`foto_url = $${i++}`);
    vals.push(normalizeFotoUrl(body.fotoUrl));
  }
  if (body.disponivel !== undefined) {
    campos.push(`disponivel = $${i++}`);
    vals.push(Boolean(body.disponivel));
  }
  if (body.pedePontoCarne !== undefined) {
    campos.push(`pede_ponto_carne = $${i++}`);
    vals.push(Boolean(body.pedePontoCarne));
  }
  if (body.categoriaId !== undefined) {
    const categoriaId = numeroInteiroPositivo(body.categoriaId, 'categoriaId');
    campos.push(`categoria_id = $${i++}`);
    vals.push(categoriaId);
  }
  if (body.controlaEstoque !== undefined || body.controla_estoque !== undefined) {
    campos.push(`controla_estoque = $${i++}`);
    vals.push(Boolean(body.controlaEstoque ?? body.controla_estoque));
  }
  if (body.setor !== undefined) {
    const setor = String(body.setor).trim();
    if (!['cozinha', 'bar'].includes(setor)) {
      throw new ErroAdmin(400, "setor precisa ser 'cozinha' ou 'bar'");
    }
    campos.push(`setor = $${i++}`);
    vals.push(setor);
  }
  if (body.estoque !== undefined) {
    const estoque = body.estoque === null || body.estoque === ''
      ? null
      : numeroFinito(body.estoque, 'Estoque', { inteiro: true, minimo: 0 });
    campos.push(`estoque = $${i++}`);
    vals.push(estoque);
  }
  if (body.estoqueMinimo !== undefined || body.estoque_minimo !== undefined) {
    const estoqueMinimo = numeroFinito(
      body.estoqueMinimo ?? body.estoque_minimo,
      'Estoque mínimo',
      { inteiro: true, minimo: 0 }
    );
    campos.push(`estoque_minimo = $${i++}`);
    vals.push(estoqueMinimo);
  }
  if (!campos.length) throw new ErroAdmin(400, 'Nada para atualizar');

  vals.push(id);
  const { rows } = await pool.query(
        `UPDATE produtos SET ${campos.join(', ')} WHERE id = $${i}
     RETURNING id, categoria_id, nome, descricao, preco, foto_url, disponivel, pede_ponto_carne, setor, controla_estoque, estoque, estoque_minimo, ordem`,
    vals
  );
  if (!rows[0]) throw new ErroAdmin(404, 'Produto não encontrado');
  return mapProdutoRow(rows[0]);
}

async function criarAdicional(produtoId, { nome, preco }) {
  const n = String(nome || '').trim();
  const p = numeroFinito(preco, 'Preço', { minimo: 0 });
  if (!n) throw new ErroAdmin(400, 'Nome do adicional é obrigatório');

  const { rows: prod } = await pool.query('SELECT id FROM produtos WHERE id = $1', [produtoId]);
  if (!prod[0]) throw new ErroAdmin(404, 'Produto não encontrado');

  const { rows } = await pool.query(
    'INSERT INTO adicionais (produto_id, nome, preco) VALUES ($1, $2, $3) RETURNING id, produto_id, nome, preco',
    [produtoId, n, p]
  );
  return { id: rows[0].id, produtoId: rows[0].produto_id, nome: rows[0].nome, preco: Number(rows[0].preco) };
}

async function removerAdicional(id) {
  const { rowCount } = await pool.query('DELETE FROM adicionais WHERE id = $1', [id]);
  if (!rowCount) throw new ErroAdmin(404, 'Adicional não encontrado');
  return { ok: true };
}

async function setRemoviveis(produtoId, ingredientes) {
  const lista = Array.isArray(ingredientes)
    ? [...new Set(ingredientes.map((x) => String(x).trim()).filter(Boolean))]
    : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: prod } = await client.query('SELECT id FROM produtos WHERE id = $1', [produtoId]);
    if (!prod[0]) throw new ErroAdmin(404, 'Produto não encontrado');

    await client.query('DELETE FROM produtos_ingredientes_removiveis WHERE produto_id = $1', [produtoId]);
    for (const ing of lista) {
      await client.query(
        'INSERT INTO produtos_ingredientes_removiveis (produto_id, ingrediente) VALUES ($1, $2)',
        [produtoId, ing]
      );
    }
    await client.query('COMMIT');
    return { produtoId, removiveis: lista };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function removerProduto(id) {
  const { rows: used } = await pool.query(
    'SELECT 1 FROM itens_pedido WHERE produto_id = $1 LIMIT 1',
    [id]
  );
  if (used[0]) {
    throw new ErroAdmin(
      409,
      'Produto já aparece em pedidos antigos e não pode ser excluído. Use Pausar ou Esgotar.'
    );
  }
  const { rows: usedAdd } = await pool.query(
    `SELECT 1 FROM itens_pedido_adicionais ia
     JOIN adicionais a ON a.id = ia.adicional_id
     WHERE a.produto_id = $1 LIMIT 1`,
    [id]
  );
  if (usedAdd[0]) {
    throw new ErroAdmin(
      409,
      'Opções deste produto já foram usadas em pedidos e não podem ser excluídas. Use Pausar.'
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM produtos_ingredientes_removiveis WHERE produto_id = $1', [id]);
    await client.query('DELETE FROM adicionais WHERE produto_id = $1', [id]);
    const { rowCount } = await client.query('DELETE FROM produtos WHERE id = $1', [id]);
    if (!rowCount) throw new ErroAdmin(404, 'Produto não encontrado');
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Reordena categorias: ids na ordem desejada → ordem 0..n-1 */
async function reordenarCategorias(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new ErroAdmin(400, 'ids é obrigatório');
  const lista = ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  if (lista.length !== ids.length) throw new ErroAdmin(400, 'ids inválidos');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT id FROM categorias');
    const existingSet = new Set(existing.map((r) => r.id));
    if (lista.length !== existingSet.size || lista.some((id) => !existingSet.has(id))) {
      throw new ErroAdmin(400, 'Lista de categorias incompleta ou inválida');
    }
    for (let i = 0; i < lista.length; i++) {
      await client.query('UPDATE categorias SET ordem = $1 WHERE id = $2', [i, lista[i]]);
    }
    await client.query('COMMIT');
    return { ok: true, ids: lista };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Reordena produtos de uma categoria: ids na ordem desejada → ordem 0..n-1 */
async function reordenarProdutos(categoriaId, ids) {
  const catId = numeroInteiroPositivo(categoriaId, 'categoriaId');
  if (!Array.isArray(ids) || !ids.length) throw new ErroAdmin(400, 'ids é obrigatório');
  const lista = ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  if (lista.length !== ids.length) throw new ErroAdmin(400, 'ids inválidos');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query(
      'SELECT id FROM produtos WHERE categoria_id = $1',
      [catId]
    );
    const existingSet = new Set(existing.map((r) => r.id));
    if (lista.length !== existingSet.size || lista.some((id) => !existingSet.has(id))) {
      throw new ErroAdmin(400, 'Lista de produtos incompleta ou inválida para esta categoria');
    }
    for (let i = 0; i < lista.length; i++) {
      await client.query('UPDATE produtos SET ordem = $1 WHERE id = $2 AND categoria_id = $3', [
        i,
        lista[i],
        catId,
      ]);
    }
    await client.query('COMMIT');
    return { ok: true, categoriaId: catId, ids: lista };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Exclui categoria e todos os produtos dela (cascata).
 *  Bloqueia se algum produto já aparece em pedidos (histórico). */
async function removerCategoria(id) {
  const catId = Number(id);
  if (!catId) throw new ErroAdmin(400, 'ID inválido');

  const { rows: cats } = await pool.query(
    'SELECT id, nome FROM categorias WHERE id = $1',
    [catId]
  );
  if (!cats[0]) throw new ErroAdmin(404, 'Categoria não encontrada');
  const cat = cats[0];

  const { rows: prods } = await pool.query(
    'SELECT id, nome FROM produtos WHERE categoria_id = $1 ORDER BY nome',
    [catId]
  );

  const locked = [];
  for (const p of prods) {
    const { rows: used } = await pool.query(
      'SELECT 1 FROM itens_pedido WHERE produto_id = $1 LIMIT 1',
      [p.id]
    );
    if (used[0]) {
      locked.push(p.nome);
      continue;
    }
    const { rows: usedAdd } = await pool.query(
      `SELECT 1 FROM itens_pedido_adicionais ia
       JOIN adicionais a ON a.id = ia.adicional_id
       WHERE a.produto_id = $1 LIMIT 1`,
      [p.id]
    );
    if (usedAdd[0]) locked.push(p.nome);
  }

  if (locked.length) {
    const amostra = locked.slice(0, 5).join(', ');
    const mais = locked.length > 5 ? ` e mais ${locked.length - 5}` : '';
    throw new ErroAdmin(
      409,
      `Não dá para excluir a categoria \"${cat.nome}\": ${locked.length} produto(s) já aparecem em pedidos antigos (${amostra}${mais}). Pause esses itens ou mova-os para outra categoria.`
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of prods) {
      await client.query('DELETE FROM produtos_ingredientes_removiveis WHERE produto_id = $1', [p.id]);
      await client.query('DELETE FROM adicionais WHERE produto_id = $1', [p.id]);
      await client.query('DELETE FROM produtos WHERE id = $1', [p.id]);
    }
    const { rowCount } = await client.query('DELETE FROM categorias WHERE id = $1', [catId]);
    if (!rowCount) throw new ErroAdmin(404, 'Categoria não encontrada');
    await client.query('COMMIT');
    return {
      ok: true,
      id: catId,
      nome: cat.nome,
      produtosRemovidos: prods.length,
      produtos: prods.map((p) => p.nome),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  ErroAdmin,
  listMesas,
  getCardapioAdmin,
  criarCategoria,
  atualizarCategoria,
  removerCategoria,
  reordenarCategorias,
  criarProduto,
  atualizarProduto,
  reordenarProdutos,
  criarAdicional,
  removerAdicional,
  setRemoviveis,
  removerProduto,
};

// Popula categorias/produtos/adicionais a partir do data/db.json atual.
// Idempotente: se já existir categoria, aborta cardápio sem FORCE_SEED.
// Mesas 1..NUM_MESAS sempre garantidas.
// Compatível com schema simples e com V3 (estabelecimento_id).
//
// Uso: node db/seed.js
//      FORCE_SEED=1 node db/seed.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const { garantirStaffSeed } = require('./auth');

const DB_JSON = path.join(__dirname, '..', 'data', 'db.json');
const NUM_MESAS = 20;

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return rows.length > 0;
}

/** Resolve o estabelecimento padrão (V3). Cria um se a tabela existir e estiver vazia. */
async function resolverEstabelecimentoId(client) {
  if (!(await tableExists(client, 'estabelecimentos'))) return null;

  const { rows } = await client.query(
    'SELECT id FROM estabelecimentos ORDER BY id ASC LIMIT 1'
  );
  if (rows.length) return rows[0].id;

  // tenta colunas comuns de um cadastro mínimo
  try {
    const ins = await client.query(
      `INSERT INTO estabelecimentos (nome) VALUES ('Pier 509') RETURNING id`
    );
    console.log('🏪 Estabelecimento "Pier 509" criado (id=' + ins.rows[0].id + ').');
    return ins.rows[0].id;
  } catch (e) {
    // schema pode exigir mais campos — tenta slug/nome
    try {
      const ins = await client.query(
        `INSERT INTO estabelecimentos (nome, slug) VALUES ('Pier 509', 'pier-509') RETURNING id`
      );
      console.log('🏪 Estabelecimento "Pier 509" criado (id=' + ins.rows[0].id + ').');
      return ins.rows[0].id;
    } catch (e2) {
      console.error('Não foi possível criar estabelecimento automaticamente:', e2.message);
      throw new Error(
        'Tabela estabelecimentos existe mas está vazia. Crie um registro e rode o seed de novo.'
      );
    }
  }
}

async function garantirMesas(client) {
  const hasEstab = await columnExists(client, 'mesas', 'estabelecimento_id');
  const estabId = hasEstab ? await resolverEstabelecimentoId(client) : null;

  // UNIQUE em (numero) só faz sentido no schema simples;
  // no multi-tenant o único costuma ser (estabelecimento_id, numero).
  if (!hasEstab) {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'mesas' AND c.contype = 'u'
            AND pg_get_constraintdef(c.oid) ILIKE '%(numero)%'
        ) THEN
          BEGIN
            ALTER TABLE mesas ADD CONSTRAINT mesas_numero_key UNIQUE (numero);
          EXCEPTION WHEN duplicate_table OR duplicate_object OR unique_violation THEN
            NULL;
          END;
        END IF;
      END $$;
    `);
  }

  for (let numero = 1; numero <= NUM_MESAS; numero++) {
    if (hasEstab && estabId != null) {
      await client.query(
        `INSERT INTO mesas (numero, estabelecimento_id)
         SELECT $1::int, $2::int
         WHERE NOT EXISTS (
           SELECT 1 FROM mesas
           WHERE numero = $1::int AND estabelecimento_id = $2::int
         )`,
        [numero, estabId]
      );
    } else if (hasEstab && estabId == null) {
      throw new Error('mesas.estabelecimento_id é obrigatório, mas não há estabelecimento cadastrado.');
    } else {
      await client.query(
        `INSERT INTO mesas (numero)
         SELECT $1::int
         WHERE NOT EXISTS (SELECT 1 FROM mesas WHERE numero = $1::int)`,
        [numero]
      );
    }
  }

  const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM mesas');
  console.log(
    `✅ Mesas 1–${NUM_MESAS} garantidas (total no banco: ${rows[0].n}` +
      (estabId != null ? `, estabelecimento_id=${estabId}` : '') +
      ').'
  );
  return estabId;
}


async function garantirGarcons(client) {
  const has = await tableExists(client, 'garcons');
  if (!has) return { created: false, skipped: true };
  const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM garcons');
  if (rows[0].n > 0) return { created: false, count: rows[0].n };
  const { rows: ins } = await client.query(
    `INSERT INTO garcons (nome, ativo) VALUES ('Garçom 1', true)
     RETURNING id, nome, token`
  );
  console.log('🧑 Garçom seed criado:', ins[0].nome, '· token', ins[0].token);
  return { created: true, count: 1, token: ins[0].token };
}

async function run() {
  const raw = JSON.parse(fs.readFileSync(DB_JSON, 'utf8'));
  const client = await pool.connect();
  const force = process.env.FORCE_SEED === '1' || process.argv.includes('--force');

  try {
    const estabId = await garantirMesas(client);
    await garantirGarcons(client);
    const catHasEstab = await columnExists(client, 'categorias', 'estabelecimento_id');

    const { rows: existentes } = await client.query('SELECT COUNT(*)::int AS n FROM categorias');
    if (existentes[0].n > 0 && !force) {
      console.log('⚠️  Já existem categorias no banco. Seed de cardápio abortado para não duplicar.');
      console.log('   Para substituir o cardápio: FORCE_SEED=1 npm run db:seed');
      const staff = await garantirStaffSeed();
      if (staff.created) {
        console.log('👤 Staff inicial criado (admin / cozinha / caixa).');
      } else {
        console.log(`👤 Staff já existe (${staff.count} usuário(s)).`);
      }
      return;
    }

    await client.query('BEGIN');

    if (force && existentes[0].n > 0) {
      await client.query('DELETE FROM itens_pedido_adicionais');
      await client.query('DELETE FROM itens_pedido_remocoes');
      await client.query('DELETE FROM itens_pedido');
      await client.query('DELETE FROM pedidos');
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sessao_pagamentos') THEN
            DELETE FROM sessao_pagamentos;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pix_avisos') THEN
            DELETE FROM pix_avisos;
          END IF;
        END $$;
      `);
      await client.query('DELETE FROM mesa_sessoes');
      await client.query('DELETE FROM adicionais');
      await client.query('DELETE FROM produtos_ingredientes_removiveis');
      await client.query('DELETE FROM produtos');
      await client.query('DELETE FROM categorias');
      console.log('🗑️  Cardápio e pedidos anteriores removidos (FORCE_SEED).');
    }

    const categoriasNomes = [...new Set(raw.menu.map((p) => p.category))];
    const categoriaIdPorNome = {};

    for (let i = 0; i < categoriasNomes.length; i++) {
      const nome = categoriasNomes[i];
      let rows;
      if (catHasEstab) {
        if (estabId == null) {
          throw new Error('categorias.estabelecimento_id existe, mas não há estabelecimento.');
        }
        ({ rows } = await client.query(
          'INSERT INTO categorias (nome, ordem, estabelecimento_id) VALUES ($1, $2, $3) RETURNING id',
          [nome, i, estabId]
        ));
      } else {
        ({ rows } = await client.query(
          'INSERT INTO categorias (nome, ordem) VALUES ($1, $2) RETURNING id',
          [nome, i]
        ));
      }
      categoriaIdPorNome[nome] = rows[0].id;
    }
    console.log(`✅ ${categoriasNomes.length} categorias inseridas.`);

    const prodHasPonto = await columnExists(client, 'produtos', 'pede_ponto_carne');

    let totalProdutos = 0;
    let totalAdicionais = 0;
    let totalRemoviveis = 0;

    for (const p of raw.menu) {
      const categoriaId = categoriaIdPorNome[p.category];
      const pedePontoCarne = Boolean(p.customization?.meatPoint);
      let rows;
      if (prodHasPonto) {
        ({ rows } = await client.query(
          `INSERT INTO produtos (categoria_id, nome, descricao, preco, disponivel, pede_ponto_carne)
           VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id`,
          [categoriaId, p.name, p.description || null, p.price, pedePontoCarne]
        ));
      } else {
        ({ rows } = await client.query(
          `INSERT INTO produtos (categoria_id, nome, descricao, preco, disponivel)
           VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
          [categoriaId, p.name, p.description || null, p.price]
        ));
      }
      const produtoId = rows[0].id;
      totalProdutos++;

      const additions = p.customization?.additions || [];
      for (const a of additions) {
        await client.query(
          'INSERT INTO adicionais (produto_id, nome, preco) VALUES ($1, $2, $3)',
          [produtoId, a.name, a.price]
        );
        totalAdicionais++;
      }

      if (await tableExists(client, 'produtos_ingredientes_removiveis')) {
        const removals = p.customization?.removals || [];
        for (const ingrediente of removals) {
          await client.query(
            'INSERT INTO produtos_ingredientes_removiveis (produto_id, ingrediente) VALUES ($1, $2)',
            [produtoId, ingrediente]
          );
          totalRemoviveis++;
        }
      }
    }

    
    try {
      const { rowCount } = await client.query(`
        UPDATE produtos p
           SET controla_estoque = TRUE,
               estoque = COALESCE(NULLIF(p.estoque, 0), 36),
               estoque_minimo = GREATEST(COALESCE(p.estoque_minimo, 0), 6)
          FROM categorias c
         WHERE p.categoria_id = c.id
           AND (
             c.nome ILIKE '%bebida%'
             OR c.nome ILIKE '%long neck%'
             OR c.nome ILIKE '%cerveja%'
             OR c.nome ILIKE '%dose%'
             OR c.nome ILIKE '%caipi%'
             OR c.nome ILIKE '%drink%'
             OR c.nome ILIKE '%refriger%'
           )
           AND (p.controla_estoque IS NOT TRUE OR p.estoque IS NULL)
      `);
      console.log(`📦 Estoque habilitado em ${rowCount} produto(s) de bebida.`);
    } catch (e) {
      console.warn('Aviso ao definir estoque de bebidas:', e.message || e);
    }

    await client.query('COMMIT');
    console.log(
      `✅ ${totalProdutos} produtos, ${totalAdicionais} adicionais e ${totalRemoviveis} ingredientes removíveis inseridos.`
    );

    const staff = await garantirStaffSeed();
    if (staff.created) {
      console.log('👤 Staff inicial criado (admin / cozinha / caixa).');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

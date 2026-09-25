// Runner simples de migrations, sem framework externo.
// Lê db/migrations/*.sql em ordem alfabética, aplica os que ainda não
// rodaram (controlados pela tabela schema_migrations) dentro de uma
// transação cada.
//
// Uso: node db/migrate.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function run() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const pending = files.filter((f) => !applied.has(f));

    if (!pending.length) {
      console.log('✅ Nenhuma migration pendente. Banco já está atualizado.');
      return;
    }

    for (const filename of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      console.log(`▶ Aplicando ${filename}...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`  ✅ ${filename} aplicada.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ Falha em ${filename}, rollback feito.`);
        throw err;
      }
    }

    console.log(`✅ ${pending.length} migration(s) aplicada(s) com sucesso.`);
  } finally {
    client.release();
    // Só encerra o pool quando rodado via CLI (node db/migrate.js).
    // Se importado pelo start-production, o server.js reutiliza o mesmo módulo —
    // pool.end() aqui derrubava todas as conexões e o app ficava morto.
    if (require.main === module) {
      await pool.end();
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

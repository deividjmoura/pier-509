require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');

/**
 * Start de produção:
 * 1) Tenta migrations (não mata o processo se o banco falhar temporariamente —
 *    evita 502 permanente no Railway).
 * 2) Sobe o server.js.
 *
 * O runner de migrate NÃO deve dar pool.end() quando não é CLI (ver db/migrate.js).
 */
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, '..', 'db', 'migrate.js')],
  {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: 'inherit',
    env: process.env,
  }
);

if (result.error) {
  console.error('⚠️ Não foi possível executar migrations:', result.error.message || result.error);
  console.error('   Subindo servidor mesmo assim — endpoints de DB podem falhar até o banco responder.');
} else if (result.status !== 0) {
  console.error(`⚠️ Migrations retornaram exit ${result.status ?? '?'}.`);
  console.error('   Subindo servidor mesmo assim. Verifique DATABASE_URL e logs do migrate.');
} else {
  console.log('✅ Migrations verificadas. Iniciando servidor de produção...');
}

require('../server.js');

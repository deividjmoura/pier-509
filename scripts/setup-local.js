/* Bootstrap local em 1 comando: cria .env (se não existir), roda migrations e seed.
   Uso: npm run setup   (requer Postgres acessível — veja .env.example) */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('📄 .env criado a partir do .env.example — confira o DATABASE_URL.');
  } else {
    console.error('❌ .env e .env.example não encontrados.');
    process.exit(1);
  }
} else {
  console.log('📄 .env já existe — mantendo.');
}

for (const script of ['db/migrate.js', 'db/seed.js']) {
  const r = spawnSync(process.execPath, [path.join(root, script)], {
    stdio: 'inherit',
    cwd: root,
  });
  if (r.status !== 0) {
    console.error('');
    console.error('❌ Falha ao rodar ' + script + '.');
    console.error('   Verifique se o Postgres está rodando e se o DATABASE_URL do .env aponta para ele.');
    console.error('   Exemplo local: postgres://usuario:senha@127.0.0.1:5432/lanchonete_qr');
    process.exit(r.status || 1);
  }
}

console.log('');
console.log('✅ Pronto! Agora rode: npm start  →  http://localhost:3000');
console.log('   Login de teste: admin / admin123 (ou a senha definida em STAFF_SEED_PASSWORD).');

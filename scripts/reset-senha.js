#!/usr/bin/env node
/**
 * Redefine a senha de admin / cozinha / caixa para o valor de STAFF_SEED_PASSWORD.
 *
 * Uso:
 *   node scripts/reset-senha.js
 *   STAFF_SEED_PASSWORD=minha-senha node scripts/reset-senha.js
 */
require('dotenv').config();
const { hashSenha, garantirStaffSeed } = require('../db/auth');
const pool = require('../db/pool');

async function main() {
  const senha = process.env.STAFF_SEED_PASSWORD || process.env.ADMIN_PASSWORD || 'troque-esta-senha';

  // Garante que os 3 usuários existam (idempotente)
  const seed = await garantirStaffSeed();
  if (seed.created) {
    console.log('Staff criado agora (estava vazio).');
  }

  const hash = await hashSenha(senha);
  const { rows } = await pool.query(
    `UPDATE staff
     SET senha_hash = $1, ativo = true
     WHERE lower(login) IN ('admin', 'cozinha', 'caixa')
     RETURNING login, papel, ativo`,
    [hash]
  );

  if (!rows.length) {
    console.error('Nenhum usuário admin/cozinha/caixa encontrado na tabela staff.');
    process.exit(1);
  }

  console.log('Senha atualizada para:', JSON.stringify(senha));
  for (const u of rows) {
    console.log(`  · ${u.login} (${u.papel}) ativo=${u.ativo}`);
  }
  console.log('\nTeste: curl -s -X POST http://127.0.0.1:3000/api/login -H "Content-Type: application/json" -d \'{"usuario":"admin","senha":"' + senha + '"}\'');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end().catch(() => {}));

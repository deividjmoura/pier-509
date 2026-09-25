const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida. Copie .env.example para .env e ajuste.');
  process.exit(1);
}

/**
 * Neon / Render colocam ?sslmode=require na URL.
 * O driver pg emite SECURITY WARNING porque trata require como verify-full.
 *
 * Estratégia:
 * 1. Remove qualquer sslmode=require|prefer|verify-ca da string
 * 2. Força sslmode=verify-full (mesmo comportamento de hoje, sem warning)
 * 3. Se DATABASE_SSL_REJECT_UNAUTHORIZED=false, usa ssl explícito sem verificação
 */
function buildPoolConfig() {
  let connectionString = String(process.env.DATABASE_URL).trim();

  // Remove sslmode problemático (funciona mesmo com senha especial / URL “suja”)
  connectionString = connectionString.replace(
    /([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi,
    (_, sep, _mode, end) => (end === '&' ? sep : '')
  );
  // Limpa ? ou & sobrando no final
  connectionString = connectionString
    .replace(/\?&/, '?')
    .replace(/[?&]$/, '');

  const wantsNoVerify = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false';
  const hasSslHint =
    process.env.DATABASE_SSL === 'true' ||
    /[?&]sslmode=/i.test(process.env.DATABASE_URL) ||
    /neon\.tech|render\.com|amazonaws\.com|supabase\.co/i.test(process.env.DATABASE_URL || '');

  if (wantsNoVerify) {
    // Provedor com cert que o Node não confia — SSL sem validar hostname/CA
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
    };
  }

  if (hasSslHint || /[?&]sslmode=/i.test(connectionString)) {
    // Garante verify-full na string (silencia o warning)
    const join = connectionString.includes('?') ? '&' : '?';
    if (!/[?&]sslmode=/i.test(connectionString)) {
      connectionString = `${connectionString}${join}sslmode=verify-full`;
    }
  }

  return { connectionString };
}

const base = buildPoolConfig();

const pool = new Pool({
  ...base,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000),
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do PostgreSQL:', err.message || err);
});

module.exports = pool;

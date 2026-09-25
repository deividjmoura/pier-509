// Auth de staff: usuários no Postgres (papéis) + sessão persistente (cookie httpOnly).
const crypto = require('crypto');
const { promisify } = require('util');
const pool = require('./pool');

const scrypt = promisify(crypto.scrypt);

const SESSION_COOKIE = 'pier509_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;

const PAPEIS = Object.freeze(['admin', 'cozinha', 'bar', 'caixa']);

// admin acessa tudo; cozinha, bar e caixa só o próprio domínio
const ACESSO = Object.freeze({
  admin: new Set(['admin', 'cozinha', 'bar', 'caixa']),
  cozinha: new Set(['cozinha']),
  bar: new Set(['bar']),
  caixa: new Set(['caixa']),
});

const HOME_POR_PAPEL = Object.freeze({
  admin: '/admin',
  cozinha: '/cozinha',
  bar: '/bar',
  caixa: '/caixa',
});

class ErroAuth extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function cookieDeSessao(token) {
  const partes = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === 'production') partes.push('Secure');
  return partes.join('; ');
}

function cookieDeLogout() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

async function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(senha), salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${Buffer.from(derived).toString('hex')}`;
}

async function verificarSenha(senha, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const esperado = Buffer.from(hashHex, 'hex');
    const derived = await scrypt(String(senha || ''), salt, SCRYPT_KEYLEN);
    const atual = Buffer.from(derived);
    if (atual.length !== esperado.length) return false;
    return crypto.timingSafeEqual(atual, esperado);
  } catch {
    return false;
  }
}

function staffPublico(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    login: row.login,
    papel: row.papel,
  };
}

async function contarStaff() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM staff');
  return rows[0].n;
}

/** Garante usuários iniciais (idempotente). */
async function garantirStaffSeed() {
  const n = await contarStaff();
  if (n > 0) return { created: false, count: n };

  const senhaConfigurada = process.env.STAFF_SEED_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!senhaConfigurada) {
    if (process.env.NODE_ENV === 'production') {
      throw new ErroAuth(503, 'Bootstrap de staff não configurado. Defina STAFF_SEED_PASSWORD antes do primeiro acesso.');
    }
    return { created: false, count: 0, skipped: true, reason: 'senha de bootstrap ausente' };
  }

  const senhaPadrao = String(senhaConfigurada);
  if (senhaPadrao.length < 12) {
    throw new ErroAuth(503, 'A senha de bootstrap deve ter pelo menos 12 caracteres.');
  }

  const hash = await hashSenha(senhaPadrao);
  const users = [
    { nome: 'Administrador', login: 'admin', papel: 'admin' },
    { nome: 'Cozinha', login: 'cozinha', papel: 'cozinha' },
    { nome: 'Bar', login: 'bar', papel: 'bar' },
    { nome: 'Caixa', login: 'caixa', papel: 'caixa' },
  ];
  for (const u of users) {
    await pool.query(
      `INSERT INTO staff (nome, login, senha_hash, papel)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (login) DO NOTHING`,
      [u.nome, u.login, hash, u.papel]
    );
  }
  return { created: true, count: users.length, senhaPadraoUsada: true };
}

async function autenticar(login, senha) {
  const user = String(login || '').trim().toLowerCase();
  if (!user || !senha) {
    throw new ErroAuth(400, 'Informe usuário e senha');
  }

  const { rows } = await pool.query(
    `SELECT id, nome, login, senha_hash, papel, ativo
     FROM staff WHERE lower(login) = $1 LIMIT 1`,
    [user]
  );
  const row = rows[0];
  if (!row || !row.ativo) {
    throw new ErroAuth(401, 'Usuário ou senha incorretos');
  }
  const ok = await verificarSenha(senha, row.senha_hash);
  if (!ok) {
    throw new ErroAuth(401, 'Usuário ou senha incorretos');
  }
  return staffPublico(row);
}

async function criarSessao(staffId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO staff_sessoes (token, staff_id, expira_em)
     VALUES ($1, $2, $3)`,
    [token, staffId, expira]
  );
  return token;
}

async function destruirSessao(token) {
  if (!token) return;
  await pool.query('DELETE FROM staff_sessoes WHERE token = $1', [token]);
}

async function getStaffDaRequisicao(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const { rows } = await pool.query(
    `SELECT s.id, s.nome, s.login, s.papel, s.ativo, ss.expira_em
     FROM staff_sessoes ss
     JOIN staff s ON s.id = ss.staff_id
     WHERE ss.token = $1`,
    [token]
  );
  const row = rows[0];
  if (!row || !row.ativo) {
    if (token) await destruirSessao(token);
    return null;
  }
  if (new Date(row.expira_em).getTime() <= Date.now()) {
    await destruirSessao(token);
    return null;
  }

  // Touch leve (não bloqueia se falhar)
  pool
    .query('UPDATE staff_sessoes SET ultimo_uso = now() WHERE token = $1', [token])
    .catch(() => {});

  return staffPublico(row);
}

async function estaAutenticado(req) {
  const staff = await getStaffDaRequisicao(req);
  return Boolean(staff);
}

function papelPodeAcessar(papel, recurso) {
  const set = ACESSO[papel];
  return Boolean(set && set.has(recurso));
}

function verificarOrigemRequisicao(req) {
  const metodo = String(req.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(metodo)) return;

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const hostsPermitidos = new Set(
    String(process.env.CSRF_ALLOWED_ORIGINS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  );

  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = req.headers.host;
  const origemLocal = host ? `${proto}://${host}` : null;
  if (origemLocal) hostsPermitidos.add(origemLocal);

  const candidato = origin || (referer ? (() => {
    try { return new URL(referer).origin; } catch { return null; }
  })() : null);

  // Navegadores modernos enviam Origin em métodos inseguros. Quando ambos
  // estão ausentes, mantemos compatibilidade com clientes não-browser.
  if (candidato && !hostsPermitidos.has(candidato)) {
    throw new ErroAuth(403, 'Origem da requisição não permitida');
  }
}

/** recurso: 'admin' | 'cozinha' | 'bar' | 'caixa' */
async function exigirAcesso(req, recurso) {
  const staff = await getStaffDaRequisicao(req);
  if (!staff) {
    const err = new ErroAuth(401, 'Não autenticado');
    throw err;
  }
  verificarOrigemRequisicao(req);
  if (!papelPodeAcessar(staff.papel, recurso)) {
    throw new ErroAuth(403, 'Sem permissão para esta área');
  }
  return staff;
}

function homeDoPapel(papel) {
  return HOME_POR_PAPEL[papel] || '/admin';
}

// Limpa sessões expiradas de tempos em tempos
setInterval(() => {
  pool
    .query('DELETE FROM staff_sessoes WHERE expira_em < now()')
    .catch(() => {});
}, 30 * 60 * 1000).unref();

module.exports = {
  ErroAuth,
  SESSION_COOKIE,
  PAPEIS,
  parseCookies,
  cookieDeSessao,
  cookieDeLogout,
  hashSenha,
  verificarSenha,
  autenticar,
  criarSessao,
  destruirSessao,
  getStaffDaRequisicao,
  estaAutenticado,
  exigirAcesso,
  papelPodeAcessar,
  homeDoPapel,
  garantirStaffSeed,
  contarStaff,
  verificarOrigemRequisicao,
};

/**
 * Otimização de fotos de cardápio.
 * Redimensiona (máx 960px) → WebP leve e grava o resultado como data-URL
 * em foto_url (Postgres). Assim a imagem sobrevive a redeploy / disco efêmero.
 *
 * URLs https:// externas continuam válidas (não baixamos de novo no cardápio).
 * Paths /uploads/... antigos ainda são aceitos se o arquivo existir no disco.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

let _sharp;
function getSharp() {
  if (!_sharp) {
    try {
      _sharp = require('sharp');
    } catch (e) {
      const err = new Error('Módulo sharp indisponível neste ambiente: ' + (e && e.message ? e.message : e));
      err.status = 503;
      throw err;
    }
  }
  return _sharp;
}

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const MAX_EDGE = Number(process.env.FOTO_MAX_EDGE || 960);
const WEBP_QUALITY = Number(process.env.FOTO_WEBP_QUALITY || 82);
const MAX_INPUT_BYTES = Number(process.env.FOTO_MAX_INPUT_BYTES || 6 * 1024 * 1024);
/** Tamanho máximo do WebP otimizado antes de virar data-URL (~280 KB). */
const MAX_OUTPUT_BYTES = Number(process.env.FOTO_MAX_OUTPUT_BYTES || 320 * 1024);
const FETCH_TIMEOUT_MS = 12_000;
/** true = também grava cópia em public/uploads (só útil em dev local). */
const ALSO_WRITE_DISK = process.env.FOTO_ALSO_DISK === '1';

class ErroFoto extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function garantirDirUpload() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** IPv4 em notação decimal válida (0..255 x4). */
function ipv4PrivadoOuReservado(ip) {
  const oct = String(ip).split('.').map(Number);
  if (oct.length !== 4 || oct.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = oct;
  // 0/8, 10/8, 127/8, 169.254/16 (link-local), 172.16/12, 192/24 (IETF),
  // 192.0.2/24 e 198.51.100/24 / 203.0.113/24 (documentação), 198.18/15 (benchmark),
  // 100.64/10 (CGNAT), 240/4 (reservado) e multicast 224/4.
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function ipv6PrivadoOuReservado(ip) {
  const normalized = String(ip).toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  // IPv4 mapeado em IPv6 não pode virar porta de entrada. O WHATWG URL normaliza
  // `::ffff:127.0.0.1` para forma hexadecimal (`::ffff:7f00:1`), então os dois jeitos.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4PrivadoOuReservado(mapped[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return ipv4PrivadoOuReservado([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.'));
  }
  // ULA fc00::/7, link-local fe80::/10, multicast ff00::/12
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  return false;
}

function ipPrivadoOuReservado(hostname) {
  if (!hostname) return true;
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') ||
      h.endsWith('.local' + 'host')) return true;
  const family = net.isIP(h);
  if (family === 4) return ipv4PrivadoOuReservado(h);
  if (family === 6) return ipv6PrivadoOuReservado(h);
  return false;
}

async function assertUrlSegura(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl).trim());
  } catch {
    throw new ErroFoto(400, 'URL de imagem inválida');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ErroFoto(400, 'URL deve começar com http:// ou https://');
  }
  if (!u.hostname || u.username || u.password) {
    // hostname vazio ou credencial embutida (http://user:pass@host/) — o par
    // user:pass poderia ser usado para atingir um host interno com auth forjada
    throw new ErroFoto(400, 'URL de imagem inválida');
  }
  if (ipPrivadoOuReservado(u.hostname)) {
    throw new ErroFoto(400, 'Destino de rede não permitido');
  }
  let addrs;
  try {
    addrs = await dns.lookup(u.hostname, { all: true });
  } catch {
    throw new ErroFoto(400, 'Não foi possível resolver o host da imagem');
  }
  for (const a of addrs || []) {
    if (ipPrivadoOuReservado(a.address)) {
      throw new ErroFoto(400, 'Destino de rede não permitido');
    }
  }
  return u;
}

async function baixarImagem(url) {
  const u = await assertUrlSegura(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      redirect: 'error',
      headers: { 'User-Agent': 'Pier509-Foto/1.0' },
    });
    if (!res.ok) {
      throw new ErroFoto(400, 'Não foi possível baixar a imagem (HTTP ' + res.status + ')');
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream')) {
      throw new ErroFoto(400, 'A URL não aponta para uma imagem');
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_INPUT_BYTES) {
      throw new ErroFoto(413, 'Imagem remota muito grande');
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_INPUT_BYTES) {
      throw new ErroFoto(413, 'Imagem remota muito grande');
    }
    if (!buf.length) throw new ErroFoto(400, 'Imagem remota vazia');
    return buf;
  } catch (e) {
    if (e instanceof ErroFoto) throw e;
    if (e && e.name === 'AbortError') {
      throw new ErroFoto(408, 'Tempo esgotado ao baixar a imagem');
    }
    if (e && /redirect/i.test(String(e.message || e))) {
      throw new ErroFoto(400, 'Redirecionamento de imagem não permitido');
    }
    throw new ErroFoto(400, 'Falha ao baixar a imagem: ' + (e.message || 'erro de rede'));
  } finally {
    clearTimeout(t);
  }
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) throw new ErroFoto(400, 'Imagem em base64 inválida');
  let buf;
  try {
    buf = Buffer.from(m[2], 'base64');
  } catch {
    throw new ErroFoto(400, 'Base64 inválido');
  }
  if (!buf.length) throw new ErroFoto(400, 'Imagem vazia');
  if (buf.length > MAX_INPUT_BYTES) {
    throw new ErroFoto(413, 'Imagem muito grande (máx ~6 MB)');
  }
  return buf;
}

async function otimizarParaWebp(buf) {
  try {
    return await getSharp()(buf, { failOn: 'none' })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer();
  } catch (e) {
    if (e && e.status === 503) throw e;
    throw new ErroFoto(400, 'Arquivo de imagem inválido ou corrompido');
  }
}

async function processarUploadFoto(raw) {
  // server.js chama com o corpo já parseado ({ data | url }). Aceita também
  // string/Buffer direto, que é o que scripts e testes usam.
  let input = raw;
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    if (raw.data) input = raw.data;
    else if (raw.url) input = raw.url;
    else throw new ErroFoto(400, 'Envie data-URL base64, Buffer ou URL https');
  }

  let buf;
  if (typeof input === 'string' && input.startsWith('data:')) {
    buf = parseDataUrl(input);
  } else if (typeof input === 'string' && /^https?:\/\//i.test(input.trim())) {
    buf = await baixarImagem(input.trim());
  } else if (Buffer.isBuffer(input)) {
    buf = input;
  } else {
    throw new ErroFoto(400, 'Envie data-URL base64, Buffer ou URL https');
  }

  const webp = await otimizarParaWebp(buf);
  if (webp.length > MAX_OUTPUT_BYTES) {
    throw new ErroFoto(413, 'Imagem otimizada ainda muito grande');
  }

  const dataUrl = 'data:image/webp;base64,' + webp.toString('base64');

  if (ALSO_WRITE_DISK) {
    garantirDirUpload();
    const nome = crypto.randomBytes(16).toString('hex') + '.webp';
    fs.writeFileSync(path.join(UPLOAD_DIR, nome), webp);
  }

  return { fotoUrl: dataUrl, bytes: webp.length };
}

module.exports = {
  processarUploadFoto,
  ErroFoto,
  UPLOAD_DIR,
  // nome histórico do validador, usado pelo tests/regressions.cjs e por scripts
  validarDestinoRemoto: assertUrlSegura,
  assertUrlSegura,
  ipPrivadoOuReservado,
};

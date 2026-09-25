#!/usr/bin/env node
/**
 * Teste de segurança contra um servidor REAL.
 *
 * Cobre: travessia de caminho, injeção de SQL, escala de privilégio, CSRF,
 * IDOR entre mesas, XSS armazenado, rate-limit, limite de corpo, controle de
 * acesso do SSE, cabeçalhos de segurança e atributos de cookie.
 *
 * Uso: BASE_URL=http://127.0.0.1:3000 STAFF_SEED_PASSWORD=... node scripts/teste-seguranca.js
 */
require('dotenv').config();

const BASE = (process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
const SENHA = process.env.STAFF_SEED_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';

const falhas = [];
let verificados = 0;
const ok = (m) => { verificados += 1; console.log(`  \u2713 ${m}`); };
const ruim = (m) => { falhas.push(m); console.error(`  \u2717 ${m}`); };
const nota = (m) => console.log(`  ! ${m}`);
const secao = (m) => console.log(`\n  \u2500\u2500 ${m} \u2500\u2500`);

function cookieDe(setCookies) {
  return setCookies.map((c) => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
}

async function req(method, path, { body, cookie, origem, headers: h, bruto } = {}) {
  const headers = Object.assign({}, h);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (origem) headers.Origin = origem;
  let res;
  try {
    res = await fetch(BASE + path, {
      method, headers, redirect: 'manual',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
  } catch (e) {
    return { status: 0, data: null, texto: '', headers: new Headers(), erro: e.message };
  }
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  const setCookie = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  return { status: res.status, data, texto, headers: res.headers, setCookie, bruto };
}

async function login(usuario, senha = SENHA) {
  const r = await req('POST', '/api/login', { body: { usuario, senha }, origem: BASE });
  return r.status === 200 ? cookieDe(r.setCookie) : null;
}

/* ------------------------------------------------------------------ */
async function tTravessia() {
  secao('Travessia de caminho em arquivos estáticos');
  const alvos = [
    '/../server.js', '/..%2fserver.js', '/%2e%2e/server.js',
    '/....//server.js', '/assets/../../server.js',
    '/%252e%252e%252fserver.js', '/uploads/../../../etc/passwd',
    '/logo/../../../../etc/passwd',
  ];
  let vazou = 0;
  for (const a of alvos) {
    const r = await req('GET', a);
    const corpo = String(r.texto || '');
    const sensivel = /require\(|DATABASE_URL|root:.*:0:0:|module\.exports/.test(corpo);
    if (r.status === 200 && sensivel) { vazou++; ruim(`GET ${a} → 200 com conteúdo sensível`); }
  }
  if (!vazou) ok(`${alvos.length} tentativas de travessia bloqueadas (sem conteúdo sensível)`);

  const fora = await req('GET', '/assets/../../../etc/hostname');
  if (fora.status !== 200 || !/require\(|DATABASE_URL/.test(String(fora.texto))) ok('escapada relativa fora da raiz não serve arquivos do sistema');
  else ruim('escapada relativa serviu arquivo do sistema');
}

/* ------------------------------------------------------------------ */
async function tInjecao(mesa) {
  secao('Injeção de SQL');
  const payloads = [
    "' OR 1=1 --", "1; DROP TABLE pedidos; --", "1' UNION SELECT senha_hash FROM staff--",
    "' OR ''='", "1) OR (1=1", "\\'; DELETE FROM mesas; --",
  ];
  let problem = 0;
  for (const p of payloads) {
    // no token da mesa (rota pública de pedido)
    const r1 = await req('GET', `/api/mesas/${encodeURIComponent(p)}/sessao`);
    if (r1.status === 500) { problem++; ruim(`token SQLi '${p}' → 500 (erro interno vazado)`); }
    // no id de pedido
    const r2 = await req('PATCH', `/api/pedidos/${encodeURIComponent(p)}/status`, {
      cookie: null, body: { status: 'em_producao' },
    });
    if (r2.status === 500) { problem++; ruim(`id SQLi '${p}' → 500`); }
  }
  if (!problem) ok(`${payloads.length} payloads SQLi rejeitados sem erro 500`);

  // o banco continua inteiro?
  const cardapio = await req('GET', '/api/cardapio');
  if (cardapio.status === 200 && cardapio.data?.length) ok('cardápio continua íntegro após tentativas de injeção');
  else ruim('cardápio quebrou após tentativas de injeção');

  const mesas = await req('GET', `/api/mesas/${mesa.token}/sessao`);
  if (mesas.status === 200 || mesas.status === 404) ok('tabela de mesas intacta após tentativas de DROP/DELETE');
  else ruim(`leitura da mesa retornou ${mesas.status} após tentativas de DROP`);
}

/* ------------------------------------------------------------------ */
async function tPrivilegios() {
  secao('Escala de privilégio entre papéis');
  const admin = await login('admin');
  const cozinha = await login('cozinha');
  const caixa = await login('caixa');
  const bar = await login('bar');
  if (!admin || !cozinha || !caixa) return nota('login falhou — pulando privilégios');

  const casos = [
    ['cozinha em /api/admin/mesas', cozinha, '/api/admin/mesas', 'GET', 403],
    ['caixa em /api/admin/cardapio', caixa, '/api/admin/cardapio', 'GET', 403],
    ['cozinha em /api/caixa/sessoes', cozinha, '/api/caixa/sessoes', 'GET', 403],
    ['caixa em /api/cozinha/pedidos', caixa, '/api/cozinha/pedidos', 'GET', 403],
    ['bar em /api/admin/garcons', bar, '/api/admin/garcons', 'GET', 403],
    ['anônimo em /api/admin/mesas', null, '/api/admin/mesas', 'GET', 401],
    ['anônimo em /api/caixa/sessoes', null, '/api/caixa/sessoes', 'GET', 401],
    ['anônimo em /api/cozinha/pedidos', null, '/api/cozinha/pedidos', 'GET', 401],
    ['anônimo em /api/admin/historico/purge', null, '/api/admin/historico/purge', 'POST', 401],
    ['admin em /api/admin/mesas (deve passar)', admin, '/api/admin/mesas', 'GET', 200],
  ];
  let errado = 0;
  for (const [rotulo, cookie, path, method, esperado] of casos) {
    const r = await req(method, path, { cookie, body: method === 'POST' ? {} : undefined, origem: BASE });
    if (r.status !== esperado) { errado++; ruim(`${rotulo} → ${r.status}, esperado ${esperado}`); }
  }
  if (!errado) ok(`${casos.length} regras de papel respeitadas`);

  // purge sem confirmação explícita
  const purge = await req('POST', '/api/admin/historico/purge', {
    cookie: admin, origem: BASE, body: { before: '2000-01-01' },
  });
  if (purge.status !== 200 || purge.data?.ok !== true) ok('purge de histórico exige confirm=true explícito');
  else ruim('purge apagou dados sem confirm=true');

  // sessão expirada / token forjado
  const forjado = await req('GET', '/api/me', { cookie: 'pier509_session=' + 'a'.repeat(64) });
  if (forjado.status === 401) ok('cookie de sessão forjado → 401');
  else ruim(`cookie forjado → ${forjado.status}`);
}

/* ------------------------------------------------------------------ */
async function tCsrf() {
  secao('CSRF (Origin cruzado em método inseguro)');
  const admin = await login('admin');
  const r = await req('POST', '/api/admin/categorias', {
    cookie: admin, origem: 'https://evil.example.com', body: { nome: 'CSRF' },
  });
  if (r.status === 403) ok('POST com Origin externo → 403');
  else ruim(`POST com Origin externo → ${r.status} (CSRF possível)`);

  const r2 = await req('PUT', '/api/admin/categorias/ordem', {
    cookie: admin, origem: 'http://atacante.test', body: { ids: [] },
  });
  if (r2.status === 403) ok('PUT com Origin externo → 403');
  else ruim(`PUT com Origin externo → ${r2.status}`);

  // GET não deve ser bloqueado por Origin
  const r3 = await req('GET', '/api/cardapio', { origem: 'https://evil.example.com' });
  if (r3.status === 200) ok('GET público continua acessível com Origin externo');
  else ruim(`GET público com Origin externo → ${r3.status}`);
}

/* ------------------------------------------------------------------ */
async function tIdor(mesas) {
  secao('IDOR — mesa A tentando mexer na mesa B');
  if (mesas.length < 2) return nota('preciso de 2 mesas');
  const [a, b] = mesas;

  const pedido = await req('POST', `/api/mesas/${a.token}/pedidos`, {
    body: { clienteNome: 'Dona da mesa', items: [] },
  });
  // pedido vazio de propósito: pegamos um id real de outra forma
  const cardapio = await req('GET', '/api/cardapio');
  const prod = cardapio.data?.[0]?.produtos?.[0];
  if (!prod) return nota('cardápio vazio');
  const criado = await req('POST', `/api/mesas/${a.token}/pedidos`, {
    body: { clienteNome: 'Dona da mesa', items: [{ productId: prod.id, qty: 1 }] },
  });
  if (criado.status !== 201) return nota(`não consegui criar pedido na mesa A (${criado.status})`);
  const pedidoId = criado.data.id;

  const cancelar = await req('DELETE', `/api/mesas/${b.token}/pedidos/${pedidoId}`);
  if (cancelar.status === 404) ok('mesa B não consegue cancelar pedido da mesa A (404, sem vazar existência)');
  else ruim(`mesa B cancelou/editou pedido da mesa A → ${cancelar.status}`);

  const editar = await req('PUT', `/api/mesas/${b.token}/pedidos/${pedidoId}`, {
    body: { items: [{ productId: prod.id, qty: 9 }] },
  });
  if (editar.status === 404) ok('mesa B não consegue editar pedido da mesa A');
  else ruim(`mesa B editou pedido da mesa A → ${editar.status}`);

  const pix = await req('POST', `/api/mesas/${b.token}/pix-informado`, {
    body: { pedidoId, valor: 0.01 },
  });
  // 404 = pedido não pertence a esta mesa; 400 = mesa B nem tem conta aberta.
  // Qualquer um dos dois impede a mesa B de tocar no pedido da mesa A.
  if (pix.status === 404 || pix.status === 400) {
    ok(`mesa B não consegue avisar PIX sobre pedido da mesa A (${pix.status})`);
  } else ruim(`mesa B avisou PIX sobre pedido da mesa A → ${pix.status}`);
  const depois = await req('GET', `/api/mesas/${a.token}/sessao`);
  const avisos = (depois.data?.pixAvisos || []).filter((x) => x.pedidoId === pedidoId);
  if (!avisos.length) ok('nenhum aviso PIX foi criado na mesa A pela mesa B');
  else ruim('mesa B criou aviso PIX dentro da sessão da mesa A');

  const sessaoB = await req('GET', `/api/mesas/${b.token}/sessao`);
  const vaza = JSON.stringify(sessaoB.data || {}).includes(String(pedidoId));
  if (!vaza) ok('sessão da mesa B não expõe id de pedido da mesa A');
  else ruim('sessão da mesa B expõe pedido da mesa A');

  await req('DELETE', `/api/mesas/${a.token}/pedidos/${pedidoId}`);
}

/* ------------------------------------------------------------------ */
async function tXss(adminCookie) {
  secao('XSS armazenado');
  const cat = await req('GET', '/api/admin/cardapio', { cookie: adminCookie });
  const categoriaId = cat.data?.[0]?.id;
  if (!categoriaId) return nota('sem categoria');

  const maligno = '<img src=x onerror="alert(document.cookie)"><script>alert(1)</scr' + 'ipt>';
  const criado = await req('POST', '/api/admin/produtos', {
    cookie: adminCookie, origem: BASE,
    body: { nome: maligno, categoriaId, preco: 5 },
  });
  const pub = await req('GET', '/api/cardapio');
  const ct = pub.headers.get('content-type') || '';
  if (/application\/json/.test(ct)) ok('Content-Type do cardápio é application/json (não text/html)');
  else ruim(`Content-Type do cardápio: ${ct}`);

  /* O dado volta escapado pelo JSON (comportamento correto de uma API). O que
     decide se há XSS é o cliente. Auditamos src/ e não dist/: o bundle contém
     a string "dangerouslySetInnerHTML" porque o react-dom a referencia, o que
     daria falso positivo. */
  const fs = require('fs');
  const path = require('path');
  const listarTs = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? listarTs(p) : (/\.(ts|tsx)$/.test(e.name) ? [p] : []);
  });
  const fontes = fs.existsSync('src') ? listarTs('src') : [];
  if (!fontes.length) return nota('src/ ausente — não deu para auditar injeção de HTML');
  let perigoso = 0;
  for (const f of fontes) {
    const src = fs.readFileSync(f, 'utf8');
    for (const padrao of ['dangerouslySetInnerHTML', 'insertAdjacentHTML', '.innerHTML']) {
      if (src.includes(padrao)) { perigoso++; ruim(`${f} contém ${padrao}`); }
    }
  }
  if (!perigoso) ok(`${fontes.length} arquivo(s) do app sem injeção de HTML cru`);

  if (criado.status === 201) {
    await req('DELETE', `/api/admin/produtos/${criado.data.id}`, { cookie: adminCookie, origem: BASE });
    const depois = await req('GET', '/api/cardapio');
    if (!String(depois.texto).includes('onerror=')) ok('produto de teste removido — nada de payload ficou no cardápio');
    else ruim('produto de teste continuou no cardápio após DELETE');
  }
}

/* ------------------------------------------------------------------ */
async function tCorpoELimite(mesa) {
  secao('Limite de corpo e payloads abusivos');
  const token = mesa?.token || '00000000-0000-4000-8000-000000000000';
  const grande = 'x'.repeat(2 * 1024 * 1024);
  const r = await req('POST', `/api/mesas/${token}/pedidos`, {
    body: { clienteNome: 'x', note: grande },
  });
  if (r.status === 413) ok('corpo de 2 MB rejeitado com 413 (não reset de conexão)');
  else if (r.status === 0) ruim('corpo de 2 MB derrubou a conexão (cliente ficou sem resposta)');
  else ruim(`corpo de 2 MB → ${r.status}, esperado 413`);

  /* O servidor PRECISA continuar vivo depois de um corpo abusivo. Um erro no
     handler global de exceção aqui derrubava o processo inteiro. */
  const vivo = await req('GET', '/api/cardapio');
  if (vivo.status === 200) ok('servidor continuou vivo após corpo abusivo');
  else ruim(`servidor não respondeu após corpo abusivo (status ${vivo.status}) — processo caiu?`);

  // mesa real: só assim a requisição chega ao limite de itens (com token falso
  // morre antes, em "Mesa não encontrada", e o teste não prova nada)
  const itens = Array.from({ length: 5000 }, () => ({ productId: 1, qty: 1 }));
  const r2 = await req('POST', `/api/mesas/${token}/pedidos`, { body: { items: itens } });
  if ([400, 413].includes(r2.status)) ok(`5000 itens rejeitados (${r2.status})`);
  else ruim(`5000 itens → ${r2.status}`);

  const r3 = await req('POST', `/api/mesas/${token}/pedidos`, {
    body: { items: [{ productId: 1, qty: 999999 }] },
  });
  if (r3.status === 400) ok('quantidade 999999 rejeitada');
  else ruim(`quantidade absurda → ${r3.status}`);

  const r5 = await req('POST', `/api/mesas/${token}/pedidos`, {
    body: { items: [{ productId: 1, qty: 0 }] },
  });
  if (r5.status === 400) ok('quantidade 0 rejeitada');
  else ruim(`quantidade 0 → ${r5.status}`);

  const r6 = await req('POST', `/api/mesas/${token}/pedidos`, {
    body: { items: [{ productId: 999999, qty: 1 }] },
  });
  if (r6.status === 400) ok('produto inexistente rejeitado (preço nunca vem do cliente)');
  else ruim(`produto inexistente → ${r6.status}`);

  const r4 = await req('POST', `/api/mesas/${token}/pedidos`, {
    body: '{"items":[{"productId":1,"qty":1e999}]}',
  });
  if ([400, 404].includes(r4.status)) ok('qty = 1e999 (Infinity) rejeitado');
  else ruim(`qty Infinity → ${r4.status}`);
}

/* ------------------------------------------------------------------ */
async function tSse() {
  secao('SSE — controle de acesso');
  const sem = await req('GET', '/api/events');
  if (sem.status === 401) ok('SSE sem credencial → 401');
  else ruim(`SSE sem credencial → ${sem.status}`);

  const lixo = await req('GET', '/api/events?mesa=nao-existe');
  if (lixo.status === 401) ok('SSE com token de mesa inválido → 401');
  else ruim(`SSE com token inválido → ${lixo.status}`);

  const lixoG = await req('GET', '/api/events?garcom=nao-existe');
  if (lixoG.status === 401) ok('SSE com token de garçom inválido → 401');
  else ruim(`SSE com token de garçom inválido → ${lixoG.status}`);
}

/* ------------------------------------------------------------------ */
async function tCabecalhos() {
  secao('Cabeçalhos de segurança e cookies');
  const r = await req('GET', '/api/cardapio');
  const esperado = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
  let errado = 0;
  for (const [k, v] of Object.entries(esperado)) {
    const real = r.headers.get(k);
    if (real !== v) { errado++; ruim(`cabeçalho ${k} = ${real}, esperado ${v}`); }
  }
  if (!errado) ok('nosniff, X-Frame-Options DENY e Referrer-Policy presentes');

  const csp = r.headers.get('content-security-policy') || '';
  if (/default-src 'self'/.test(csp)) ok("CSP com default-src 'self'");
  else ruim('CSP ausente ou sem default-src');
  if (/frame-ancestors 'none'/.test(csp)) ok('CSP com frame-ancestors none (anti clickjacking)');
  else ruim('CSP sem frame-ancestors');

  const login = await req('POST', '/api/login', { body: { usuario: 'admin', senha: SENHA }, origem: BASE });
  const cookie = String(login.setCookie?.[0] || '');
  const precisa = ['HttpOnly', 'Path=/', 'SameSite='];
  const faltam = precisa.filter((p) => !cookie.includes(p));
  if (!faltam.length) ok('cookie de sessão HttpOnly + SameSite + Path');
  else ruim(`cookie sem: ${faltam.join(', ')} → ${cookie}`);
  if (/__Host-|^pier509_session=/.test(cookie)) ok('nome de cookie de sessão fixo (sem prefixo dinâmico)');
}

/* ------------------------------------------------------------------ */
async function tRateLimit() {
  secao('Rate-limit de login (força bruta)');
  let bloqueado = null;
  for (let i = 0; i < 14; i++) {
    const r = await req('POST', '/api/login', { body: { usuario: 'admin', senha: 'senha-errada-' + i }, origem: BASE });
    if (r.status === 429) { bloqueado = i + 1; break; }
  }
  if (bloqueado) ok(`tentativas de login bloqueadas na ${bloqueado}ª (429)`);
  else ruim('14 senhas erradas seguidas sem bloqueio — força bruta liberada');
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log(`\n\u{1F510} Teste de segurança · ${BASE}`);
  const health = await req('GET', '/api/cardapio');
  if (health.status !== 200) {
    console.error(`\u2717 servidor não respondeu em ${BASE} (status ${health.status})`);
    process.exit(1);
  }

  const admin = await login('admin');
  if (!admin) throw new Error('login admin falhou');

  const mesasReq = await req('GET', '/api/admin/mesas', { cookie: admin });
  const mesas = (mesasReq.data || []).filter((m) => !m.sessaoAberta).slice(0, 2);

  await tTravessia();
  await tInjecao(mesas[0] || { token: '00000000-0000-4000-8000-000000000000' });
  await tPrivilegios();
  await tCsrf();
  await tIdor(mesas);
  await tXss(admin);
  await tCorpoELimite(mesas[0]);
  await tSse();
  await tCabecalhos();
  await tRateLimit();

  console.log('\n' + '\u2500'.repeat(34));
  console.log(`verificações: ${verificados} · FALHAS: ${falhas.length}`);
  if (falhas.length) {
    console.log('\nFALHAS:');
    falhas.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\u2705 Segurança OK.');
}

main().catch((e) => {
  console.error('\n\u2717 teste abortado:', e && e.stack ? e.stack : e);
  process.exit(1);
});

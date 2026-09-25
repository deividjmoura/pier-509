#!/usr/bin/env node
/**
 * Smoke completo — inconsistências de API + fluxo PIX aviso/confirmação.
 * Uso: BASE_URL=https://seu-app.onrender.com npm run test:full
 *      (ou local com servidor no ar)
 */
require('dotenv').config();

const BASE = (process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
const SENHA = process.env.STAFF_SEED_PASSWORD || process.env.ADMIN_PASSWORD || 'troque-esta-senha';

let step = 0;
const issues = [];
const log = (msg) => console.log(`  ✓ ${msg}`);
const note = (msg) => {
  issues.push(msg);
  console.log(`  ⚠ ${msg}`);
};
const fail = (msg, detail) => {
  console.error(`\n  ✗ FALHOU no passo ${step}: ${msg}`);
  if (detail) console.error('   ', typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
};

function parseSetCookie(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}
function cookieHeader(setCookies) {
  return setCookies.map((c) => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
}

async function req(method, path, { body, cookie, expectStatus, soft } = {}) {
  step += 1;
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (soft) {
      note(`rede ${method} ${path}: ${e.message}`);
      return { res: null, data: null, setCookie: [] };
    }
    fail(`rede ${method} ${path}`, e.message || e);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (expectStatus != null && res.status !== expectStatus) {
    if (soft) {
      note(`${method} ${path} → HTTP ${res.status} (esperado ${expectStatus})`);
      return { res, data, setCookie: parseSetCookie(res) };
    }
    fail(`${method} ${path} → HTTP ${res.status} (esperado ${expectStatus})`, data);
  }
  return { res, data, setCookie: parseSetCookie(res) };
}

async function login(usuario) {
  const { data, setCookie } = await req('POST', '/api/login', {
    body: { usuario, senha: SENHA },
    expectStatus: 200,
  });
  if (!data?.ok) fail(`login ${usuario}`, data);
  return cookieHeader(setCookie);
}

async function main() {
  console.log(`\n🔬 Smoke FULL · ${BASE}\n`);

  // health / static
  console.log('  ── Superfície pública ──');
  await req('GET', '/', { expectStatus: 200 });
  log('GET /');
  const { data: cardapio, res: rCard } = await req('GET', '/api/cardapio', { expectStatus: 200 });
  if (!Array.isArray(cardapio) || !cardapio.length) fail('cardápio vazio', cardapio);
  const nProd = cardapio.reduce((n, c) => n + (c.produtos || []).length, 0);
  log(`cardápio: ${cardapio.length} categorias · ${nProd} produtos`);
  const cc = rCard.headers.get('cache-control') || '';
  if (!/max-age/i.test(cc)) note('API cardápio sem Cache-Control (ok se proxy sobrescrever)');
  else log('Cache-Control cardápio: ' + cc);

  // fotos: data-URL pesadas
  let heavy = 0;
  let missing = 0;
  for (const c of cardapio) {
    for (const p of c.produtos || []) {
      const f = p.fotoUrl || p.foto_url;
      if (!f) missing++;
      else if (String(f).startsWith('data:') && String(f).length > 80_000) heavy++;
    }
  }
  if (heavy) note(`${heavy} produto(s) com data-URL >80KB — rode npm run fotos:fix`);
  else log('sem data-URL enormes no cardápio');
  if (missing) log(`${missing} produto(s) sem fotoUrl (fallback demo no front)`);

  const { data: dest } = await req('GET', '/api/cardapio/destaques?limit=6', { expectStatus: 200 });
  log(`destaques: ${(dest?.itens || []).length} itens`);

  const { data: pixCfg } = await req('GET', '/api/config/pix', { expectStatus: 200 });
  if (pixCfg?.chave) log('PIX configurado');
  else note('PIX_CHAVE ausente — QR/aviso limitados');

  // staff
  console.log('\n  ── Auth staff ──');
  const cookieAdmin = await login('admin');
  const cookieCozinha = await login('cozinha');
  const cookieCaixa = await login('caixa');
  log('admin / cozinha / caixa');

  const { data: mesas } = await req('GET', '/api/admin/mesas', {
    cookie: cookieAdmin,
    expectStatus: 200,
  });
  if (!Array.isArray(mesas) || mesas.length < 1) fail('sem mesas', mesas);
  // Prefere mesa LIVRE (sem sessão aberta); evita mesa 1 suja de testes manuais
  const comToken = mesas.filter((m) => m.token);
  const livres = comToken
    .filter((m) => !m.sessaoAberta && !m.sessao_aberta)
    .sort((a, b) => Number(b.numero) - Number(a.numero));
  const mesa = livres[0] || comToken.sort((a, b) => Number(b.numero) - Number(a.numero))[0];
  if (!mesa?.token) fail('mesa sem token', mesa);
  if (!livres.length) {
    note(`nenhuma mesa livre — usando #${mesa.numero} (pode falhar no fechar se houver pedidos em andamento)`);
  }
  log(`mesa #${mesa.numero} token ok${livres.length ? ' (livre)' : ''}`);

  const { data: garcons } = await req('GET', '/api/admin/garcons', {
    cookie: cookieAdmin,
    expectStatus: 200,
  });
  const garcom = (garcons || []).find((g) => g.token || g.ativo !== false) || (garcons || [])[0];
  if (!garcom?.token) note('nenhum garçom com token — entrega via API pode falhar');
  else log(`garçom token ok`);

  // fluxo pedido
  console.log('\n  ── Pedido → cozinha → entrega → PIX ──');
  const cat = cardapio.find((c) => (c.produtos || []).length);
  const prod = cat.produtos[0];
  await req('POST', `/api/mesas/${mesa.token}/checkin`, {
    body: { clienteNome: 'SmokeFull' },
    expectStatus: 200,
    soft: true,
  });

  // API espera `items` + productId/qty (igual ao front e ao smoke.js)
  const { data: pedido } = await req('POST', `/api/mesas/${mesa.token}/pedidos`, {
    body: {
      clienteNome: 'SmokeFull',
      items: [{ productId: prod.id, qty: 1 }],
    },
    expectStatus: 201,
  });
  if (!pedido?.id) fail('pedido sem id', pedido);
  log(`pedido #${pedido.id}`);

  for (const st of ['em_producao', 'concluido']) {
    await req('PATCH', `/api/pedidos/${pedido.id}/status`, {
      cookie: cookieCozinha,
      body: { status: st },
      expectStatus: 200,
    });
  }
  log('cozinha → concluído');

  if (garcom?.token) {
    await req('POST', `/api/garcom/${garcom.token}/pedidos/${pedido.id}/entregar`, {
      expectStatus: 200,
    });
    log('entregue');
  } else {
    note('pulou entrega (sem garçom)');
  }

  const { data: sessao } = await req('GET', `/api/mesas/${mesa.token}/sessao`, { expectStatus: 200 });
  if (!sessao?.sessaoAberta) fail('sessão não aberta', sessao);
  if (!Array.isArray(sessao.pixAvisos)) note('sessão sem array pixAvisos (deploy antigo?)');
  else log(`sessão ok · pixAvisos=${sessao.pixAvisos.length} · restante=${sessao.valorRestante}`);

  // aviso PIX cliente
  const valorAviso = Number(sessao.valorRestante || sessao.totalDevido || 0);
  if (valorAviso > 0.01) {
    const { data: aviso } = await req('POST', `/api/mesas/${mesa.token}/pix-informado`, {
      body: { valor: valorAviso, clienteNome: 'SmokeFull' },
      expectStatus: 200,
    });
    if (!aviso?.ok && !aviso?.avisoId) fail('pix-informado', aviso);
    log(`PIX informado avisoId=${aviso.avisoId || aviso.id}`);

    const { data: sessao2 } = await req('GET', `/api/mesas/${mesa.token}/sessao`, { expectStatus: 200 });
    const pend = (sessao2.pixAvisos || []).filter((a) => a.status === 'pendente' || !a.status);
    if (!pend.length && !sessao2.pixInformadoEm) note('após avisar, nenhum pendente na sessão');
    else log(`mesa vê aguardando · pendentes=${pend.length || (sessao2.pixInformadoEm ? 1 : 0)}`);

    const { data: sessoes } = await req('GET', '/api/caixa/sessoes', {
      cookie: cookieCaixa,
      expectStatus: 200,
    });
    const sCx = (sessoes || []).find((s) => s.id === sessao.sessaoId || s.mesa === mesa.numero);
    if (!sCx) fail('sessão não no caixa', sessoes);
    const avisosCx = sCx.pixAvisos || [];
    const av = avisosCx.find((a) => a.status === 'pendente') || avisosCx[0];
    if (!av?.id) {
      note('caixa sem pixAvisos pendente na lista — confirme listSessoesAbertas');
    } else {
      const { data: conf } = await req(
        'POST',
        `/api/caixa/sessoes/${sCx.id}/pix-avisos/${av.id}/confirmar`,
        { cookie: cookieCaixa, body: {}, expectStatus: 200 }
      );
      if (!conf?.ok && !conf?.pagamento) fail('confirmar PIX', conf);
      log(`caixa confirmou PIX · pago=${conf.valorPago} restante=${conf.valorRestante}`);

      const { data: sessao3 } = await req('GET', `/api/mesas/${mesa.token}/sessao`, { expectStatus: 200 });
      const stillPend = (sessao3.pixAvisos || []).filter((a) => a.status === 'pendente');
      if (stillPend.length) note('ainda há aviso pendente na mesa após confirmar');
      else log('mesa atualizada: sem avisos pendentes');
      if (Number(sessao3.valorPago) < 0.01) note('valorPago ainda 0 após confirmar');
      else log(`mesa valorPago=${sessao3.valorPago}`);
    }
  } else {
    note('nada a pagar — pulou PIX (pedido talvez não entregue)');
  }

  // Fechar só a sessão deste teste (soft: pedidos legados em outras mesas não derrubam)
  const { data: sessoes2 } = await req('GET', '/api/caixa/sessoes', {
    cookie: cookieCaixa,
    expectStatus: 200,
  });
  const sOpen = (sessoes2 || []).find((s) => s.id === sessao.sessaoId);
  if (sOpen) {
    const { res: rFechar, data: dFechar } = await req(
      'POST',
      `/api/caixa/sessoes/${sOpen.id}/fechar`,
      {
        cookie: cookieCaixa,
        body: { formaPagamento: 'pix', desconto: 0, taxaServico: 0 },
        soft: true,
      }
    );
    if (rFechar && rFechar.status === 200) log('sessão do teste fechada');
    else if (rFechar && rFechar.status === 409) {
      note(
        'fechar bloqueado (pedidos em andamento nesta mesa) — comum se a mesa já tinha pedidos manuais; o fluxo PIX acima já validou'
      );
    } else if (dFechar?.error) note('fechar: ' + dFechar.error);
  } else {
    log('sessão já não aparece no caixa (quitada/fechada)');
  }

  // páginas ops
  console.log('\n  ── HTML ops ──');
  for (const path of ['/caixa', '/cozinha', '/garcom', '/admin', '/login']) {
    const { res } = await req('GET', path, { expectStatus: 200, soft: true });
    if (res && res.status === 200) log(path);
  }

  console.log('\n────────────────────────────────');
  if (issues.length) {
    console.log(`⚠ Smoke FULL terminou com ${issues.length} aviso(s):`);
    issues.forEach((i) => console.log('  - ' + i));
    console.log('');
  } else {
    console.log('✅ Smoke FULL OK — sem avisos.\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

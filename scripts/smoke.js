#!/usr/bin/env node
/**
 * Smoke test — fluxo completo + cenário multi-mesa / multi-pessoa.
 *
 * Pré-requisitos:
 *   - servidor rodando (npm start)
 *   - banco migrado + seed (npm run db:migrate && npm run db:seed)
 *   - STAFF_SEED_PASSWORD no .env (default: troque-esta-senha)
 *
 * Uso:
 *   BASE_URL=http://localhost:3000 npm run test:smoke
 *
 * Exit 0 = feliz · Exit 1 = alguém quebrou o hambúrguer no meio do caminho.
 */
require('dotenv').config();

const BASE = (process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
const SENHA = process.env.STAFF_SEED_PASSWORD || process.env.ADMIN_PASSWORD || 'troque-esta-senha';

let step = 0;
const log = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg, detail) => {
  console.error(`\n  ✗ FALHOU no passo ${step}: ${msg}`);
  if (detail) console.error('   ', typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
};

function parseSetCookie(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function cookieHeader(setCookies) {
  return setCookies
    .map((c) => String(c).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function req(method, path, { body, cookie, expectStatus } = {}) {
  step += 1;
  const url = BASE + path;
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
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
    fail(`${method} ${path} → HTTP ${res.status} (esperado ${expectStatus})`, data);
  }
  return { res, data, setCookie: parseSetCookie(res) };
}

async function login(usuario) {
  const { data, setCookie } = await req('POST', '/api/login', {
    body: { usuario, senha: SENHA },
    expectStatus: 200,
  });
  if (!data || !data.ok) fail(`login ${usuario}`, data);
  const cookie = cookieHeader(setCookie);
  if (!cookie) fail(`login ${usuario}: sem cookie de sessão`);
  log(`login ${usuario} → ${data.staff?.papel || '?'}`);
  return cookie;
}

function extrairProdutos(cardapio) {
  const produtos = [];
  if (Array.isArray(cardapio)) {
    for (const cat of cardapio) {
      for (const p of cat.produtos || cat.items || []) produtos.push(p);
    }
  } else if (cardapio && Array.isArray(cardapio.categorias)) {
    for (const cat of cardapio.categorias) {
      for (const p of cat.produtos || []) produtos.push(p);
    }
  } else if (cardapio && Array.isArray(cardapio.menu)) {
    for (const p of cardapio.menu) produtos.push(p);
  }
  if (!produtos.length && cardapio) {
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.id && (o.preco != null || o.price != null) && (o.nome || o.name)) {
        produtos.push(o);
        return;
      }
      Object.values(o).forEach(walk);
    };
    walk(cardapio);
  }
  return produtos;
}

async function main() {
  console.log(`\n🍔 Smoke Lanchonete QR · ${BASE}\n`);

  // 0. servidor vivo?
  {
    step += 1;
    try {
      const r = await fetch(BASE + '/api/config/pix');
      if (!r.ok && r.status !== 200) throw new Error('HTTP ' + r.status);
      log('servidor responde');
    } catch (e) {
      fail('servidor inacessível — rode npm start antes', e.message);
    }
  }

  // 1. cardápio público
  const { data: cardapio } = await req('GET', '/api/cardapio', { expectStatus: 200 });
  const produtos = extrairProdutos(cardapio);
  if (!produtos.length) fail('cardápio vazio — rode npm run db:seed');
  const disponiveis = produtos.filter((p) => p.disponivel !== false);
  // Preferir produto de cozinha (comida) para o fluxo clássico do smoke.
  // Bebidas (setor=bar) quebravam o teste quando a cozinha avançava o pedido.
  const deCozinha = disponiveis.filter((p) => {
    const s = (p.setor || p.setorProducao || '').toLowerCase();
    const nome = (p.nome || p.name || '').toLowerCase();
    const cat = (p.categoria || p.category || '').toLowerCase();
    if (s === 'bar') return false;
    if (s === 'cozinha') return true;
    // heurística: evita água/refrigerante/cerveja quando o cardápio não traz setor
    if (/água|agua|refrigerante|coca|suco|cerveja|chop|bebida/.test(nome)) return false;
    if (/bebida/.test(cat)) return false;
    return true;
  });
  const produto = deCozinha[0] || disponiveis[0] || produtos[0];
  const produto2 = deCozinha[1] || disponiveis.find((x) => (x.id || x.productId) !== (produto.id || produto.productId)) || disponiveis[0] || produtos[0];
  const produtoId = produto.id || produto.productId;
  const produtoId2 = produto2.id || produto2.productId;
  const preco = Number(produto.preco ?? produto.price ?? 0);
  log(`produto #${produtoId} · ${produto.nome || produto.name} · R$ ${preco.toFixed(2)}`);

  // 2. auth admin / cozinha / caixa
  const cookieAdmin = await login('admin');
  const cookieCozinha = await login('cozinha');
  const cookieCaixa = await login('caixa');

  // 3. mesas
  const { data: mesas } = await req('GET', '/api/admin/mesas', {
    cookie: cookieAdmin,
    expectStatus: 200,
  });
  if (!Array.isArray(mesas) || mesas.length < 2) {
    fail('preciso de pelo menos 2 mesas no seed para o teste multi-mesa');
  }

  // preferir mesas livres
  const livres = mesas.filter((m) => !m.sessaoAberta && m.status !== 'ocupada');
  const mesaA = livres[0] || mesas[0];
  const mesaB = livres[1] || mesas.find((m) => m.id !== mesaA.id) || mesas[1];
  if (!mesaA.token || !mesaB.token) fail('mesa sem token', { mesaA, mesaB });
  log(`mesa A=${mesaA.numero} · mesa B=${mesaB.numero}`);

  // 4. garçom
  let { data: garcons } = await req('GET', '/api/admin/garcons', {
    cookie: cookieAdmin,
    expectStatus: 200,
  });
  let garcom = (garcons || []).find((g) => g.ativo);
  if (!garcom) {
    const created = await req('POST', '/api/admin/garcons', {
      cookie: cookieAdmin,
      body: { nome: 'Smoke Tester' },
      expectStatus: 201,
    });
    garcom = created.data;
    log(`garçom criado #${garcom.id}`);
  } else {
    log(`garçom ${garcom.nome}`);
  }
  if (!garcom.token) fail('garçom sem token', garcom);

  // ==========================================================================
  // CENÁRIO 1 — fluxo clássico em uma mesa
  // ==========================================================================
  console.log('\n  ── Cenário 1: fluxo clássico ──');

  const { data: pedido1 } = await req('POST', `/api/mesas/${mesaA.token}/pedidos`, {
    body: {
      clienteNome: 'Cliente Alpha',
      items: [{ productId: produtoId, qty: 1 }],
    },
    expectStatus: 201,
  });
  if (!pedido1?.id) fail('pedido1 sem id', pedido1);
  log(`pedido #${pedido1.id} (Alpha) criado`);

  await req('PATCH', `/api/pedidos/${pedido1.id}/status`, {
    cookie: cookieCozinha,
    body: { status: 'em_producao' },
    expectStatus: 200,
  });
  await req('PATCH', `/api/pedidos/${pedido1.id}/status`, {
    cookie: cookieCozinha,
    body: { status: 'concluido' },
    expectStatus: 200,
  });
  log('cozinha: em_producao → concluido');

  const { data: entrega1 } = await req(
    'POST',
    `/api/garcom/${garcom.token}/pedidos/${pedido1.id}/entregar`,
    { expectStatus: 200 }
  );
  if (!entrega1 || entrega1.status !== 'entregue') fail('entrega1 falhou', entrega1);
  log('garçom entregou pedido 1');

  const { data: sessaoA } = await req('GET', `/api/mesas/${mesaA.token}/sessao`, {
    expectStatus: 200,
  });
  const totalA = Number(sessaoA.totalDevido || 0);
  if (totalA <= 0) fail('total devido zerado após entrega', sessaoA);
  log(`conta mesa A · R$ ${totalA.toFixed(2)}`);

  // PIX x2 (divisão)
  await req('POST', `/api/mesas/${mesaA.token}/pix-informado`, { expectStatus: 200 });
  await req('POST', `/api/mesas/${mesaA.token}/pix-informado`, { expectStatus: 200 });
  log('dois avisos PIX ok');

  // ==========================================================================
  // CENÁRIO 2 — multi-pessoa na MESMA mesa (2 pedidos concorrentes)
  // ==========================================================================
  console.log('\n  ── Cenário 2: 2 pessoas na mesma mesa ──');

  // Dois pedidos “ao mesmo tempo” (Promise.all)
  const [rPed2, rPed3] = await Promise.all([
    req('POST', `/api/mesas/${mesaA.token}/pedidos`, {
      body: {
        clienteNome: 'Cliente Beta',
        items: [{ productId: produtoId, qty: 1 }],
      },
      expectStatus: 201,
    }),
    req('POST', `/api/mesas/${mesaA.token}/pedidos`, {
      body: {
        clienteNome: 'Cliente Gamma',
        items: [{ productId: produtoId2, qty: 2 }],
      },
      expectStatus: 201,
    }),
  ]);
  const pedido2 = rPed2.data;
  const pedido3 = rPed3.data;
  if (!pedido2?.id || !pedido3?.id) fail('pedidos concorrentes falharam', { pedido2, pedido3 });
  if (pedido2.sessaoId !== pedido3.sessaoId) {
    fail('pedidos da mesma mesa devem compartilhar a mesma sessão', {
      s2: pedido2.sessaoId,
      s3: pedido3.sessaoId,
    });
  }
  log(`pedidos concorrentes #${pedido2.id} e #${pedido3.id} · mesma sessão #${pedido2.sessaoId}`);

  // Cozinha processa os dois
  for (const p of [pedido2, pedido3]) {
    await req('PATCH', `/api/pedidos/${p.id}/status`, {
      cookie: cookieCozinha,
      body: { status: 'em_producao' },
      expectStatus: 200,
    });
    await req('PATCH', `/api/pedidos/${p.id}/status`, {
      cookie: cookieCozinha,
      body: { status: 'concluido' },
      expectStatus: 200,
    });
  }
  log('cozinha processou os 2 pedidos extras');

  // Garçom entrega os dois (pode ser em paralelo)
  await Promise.all([
    req('POST', `/api/garcom/${garcom.token}/pedidos/${pedido2.id}/entregar`, {
      expectStatus: 200,
    }),
    req('POST', `/api/garcom/${garcom.token}/pedidos/${pedido3.id}/entregar`, {
      expectStatus: 200,
    }),
  ]);
  log('garçom entregou os 2 pedidos extras');

  const { data: sessaoA2 } = await req('GET', `/api/mesas/${mesaA.token}/sessao`, {
    expectStatus: 200,
  });
  const totalA2 = Number(sessaoA2.totalDevido || 0);
  if (totalA2 <= totalA) fail('total deveria ter aumentado após novos pedidos', sessaoA2);
  log(`conta mesa A atualizada · R$ ${totalA2.toFixed(2)} (era ${totalA.toFixed(2)})`);

  // ==========================================================================
  // CENÁRIO 3 — segunda mesa em paralelo
  // ==========================================================================
  console.log('\n  ── Cenário 3: mesa B em paralelo ──');

  const { data: pedidoB } = await req('POST', `/api/mesas/${mesaB.token}/pedidos`, {
    body: {
      clienteNome: 'Cliente Mesa B',
      items: [{ productId: produtoId, qty: 1 }],
    },
    expectStatus: 201,
  });
  if (!pedidoB?.id) fail('pedido mesa B sem id', pedidoB);
  log(`pedido mesa B #${pedidoB.id}`);

  await req('PATCH', `/api/pedidos/${pedidoB.id}/status`, {
    cookie: cookieCozinha,
    body: { status: 'em_producao' },
    expectStatus: 200,
  });
  await req('PATCH', `/api/pedidos/${pedidoB.id}/status`, {
    cookie: cookieCozinha,
    body: { status: 'concluido' },
    expectStatus: 200,
  });
  await req('POST', `/api/garcom/${garcom.token}/pedidos/${pedidoB.id}/entregar`, {
    expectStatus: 200,
  });
  log('mesa B entregue');

  // ==========================================================================
  // Caixa: fecha as duas mesas (divisão na A)
  // ==========================================================================
  console.log('\n  ── Caixa: divisão + fechar ──');

  const { data: sessoes } = await req('GET', '/api/caixa/sessoes', {
    cookie: cookieCaixa,
    expectStatus: 200,
  });
  const abertaA = (sessoes || []).find((s) => s.mesa === mesaA.numero || s.id === sessaoA2.sessaoId);
  const abertaB = (sessoes || []).find((s) => s.mesa === mesaB.numero);
  if (!abertaA) fail('sessão A não aparece no caixa', { sessoes });
  if (!abertaB) fail('sessão B não aparece no caixa', { sessoes });

  const restanteA = Number(abertaA.valorRestante != null ? abertaA.valorRestante : abertaA.valorTotal);
  const metade = Number(Math.max(0.01, Math.floor(restanteA * 50) / 100).toFixed(2));

  const { data: parcial } = await req('POST', `/api/caixa/sessoes/${abertaA.id}/pagamentos`, {
    cookie: cookieCaixa,
    body: { valor: metade, formaPagamento: 'pix' },
    expectStatus: 201,
  });
  if (!parcial?.ok) fail('pagamento parcial', parcial);
  log(`parcial mesa A R$ ${metade.toFixed(2)} · resta R$ ${Number(parcial.valorRestante).toFixed(2)}`);

  const { data: fechadaA } = await req('POST', `/api/caixa/sessoes/${abertaA.id}/fechar`, {
    cookie: cookieCaixa,
    body: { formaPagamento: 'dinheiro', desconto: 0, taxaServico: 0 },
    expectStatus: 200,
  });
  if (!fechadaA || fechadaA.status !== 'fechada') fail('fechar sessão A', fechadaA);
  log(`mesa A fechada · cobrado R$ ${Number(fechadaA.valorCobrado ?? fechadaA.valorTotal).toFixed(2)}`);

  const { data: fechadaB } = await req('POST', `/api/caixa/sessoes/${abertaB.id}/fechar`, {
    cookie: cookieCaixa,
    body: { formaPagamento: 'pix', desconto: 0, taxaServico: 0 },
    expectStatus: 200,
  });
  if (!fechadaB || fechadaB.status !== 'fechada') fail('fechar sessão B', fechadaB);
  log(`mesa B fechada`);

  // mesas livres de novo?
  const { data: mesas2 } = await req('GET', '/api/admin/mesas', {
    cookie: cookieAdmin,
    expectStatus: 200,
  });
  const aDepois = (mesas2 || []).find((m) => m.id === mesaA.id);
  const bDepois = (mesas2 || []).find((m) => m.id === mesaB.id);
  if (aDepois?.sessaoAberta) fail('mesa A ainda com sessão aberta', aDepois);
  if (bDepois?.sessaoAberta) fail('mesa B ainda com sessão aberta', bDepois);
  log('ambas as mesas liberadas');

  console.log('\n✅ Smoke OK — multi-mesa + multi-pessoa + divisão sobrevivem.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

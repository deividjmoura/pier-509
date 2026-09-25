#!/usr/bin/env node
/**
 * SUPER TESTE — Um dia inteiro na lanchonete
 *
 * Simula operação concorrente: várias mesas, cozinha + bar, garçom,
 * caixa (PIX, divisão, desconto/taxa), admin, cancelamento, edição,
 * entrega e fechamento.
 *
 * Uso:
 *   BASE_URL=https://pier509.com.br npm run test:dia
 *   BASE_URL=http://127.0.0.1:3000 npm run test:dia
 *
 * Exit 0 = ok · Exit 1 = falha fatal
 */
require('dotenv').config();

const BASE = (process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
const SENHA = process.env.STAFF_SEED_PASSWORD || process.env.ADMIN_PASSWORD || 'troque-esta-senha';
const MESAS_ALVO = Math.max(3, Number(process.env.TEST_MESAS || 4));
const PARALLEL_BURST = Math.max(2, Number(process.env.TEST_BURST || 3));

let step = 0;
const issues = [];
const stats = { pedidos: 0, entregas: 0, pix: 0, fechamentos: 0, cancelados: 0, editados: 0 };

const log = (msg) => console.log(`  ✓ ${msg}`);
const note = (msg) => {
  issues.push(msg);
  console.log(`  ⚠ ${msg}`);
};
const section = (t) => console.log(`\n  ── ${t} ──`);
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
      return { res: null, data: null, setCookie: [], status: 0 };
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
      return { res, data, setCookie: parseSetCookie(res), status: res.status };
    }
    fail(`${method} ${path} → HTTP ${res.status} (esperado ${expectStatus})`, data);
  }
  return { res, data, setCookie: parseSetCookie(res), status: res.status };
}

async function login(usuario) {
  const { data, setCookie } = await req('POST', '/api/login', {
    body: { usuario, senha: SENHA },
    expectStatus: 200,
  });
  if (!data?.ok) fail(`login ${usuario}`, data);
  const cookie = cookieHeader(setCookie);
  if (!cookie) fail(`login ${usuario}: sem cookie`);
  return { cookie, staff: data.staff, home: data.home };
}

function extrairProdutos(cardapio) {
  const produtos = [];
  if (Array.isArray(cardapio)) {
    for (const cat of cardapio) {
      for (const p of cat.produtos || cat.items || []) {
        produtos.push({ ...p, _cat: cat.nome || cat.name });
      }
    }
  }
  return produtos;
}

function splitSetor(produtos) {
  const cozinha = [];
  const bar = [];
  for (const p of produtos) {
    if (p.disponivel === false) continue;
    const s = String(p.setor || p.setorProducao || '').toLowerCase();
    const nome = String(p.nome || p.name || '').toLowerCase();
    const cat = String(p._cat || p.categoria || '').toLowerCase();
    const isBar =
      s === 'bar' ||
      /bebida|água|agua|refrigerante|coca|suco|cerveja|chop|drink|caipi/.test(nome) ||
      /bebida/.test(cat);
    if (isBar) bar.push(p);
    else cozinha.push(p);
  }
  return { cozinha, bar };
}

async function avancarPedido(pedidoId, cookieStaff) {
  await req('PATCH', `/api/pedidos/${pedidoId}/status`, {
    cookie: cookieStaff,
    body: { status: 'em_producao' },
    expectStatus: 200,
  });
  await req('PATCH', `/api/pedidos/${pedidoId}/status`, {
    cookie: cookieStaff,
    body: { status: 'concluido' },
    expectStatus: 200,
  });
}

async function main() {
  const t0 = Date.now();
  console.log(`\n🍔 SUPER TESTE · Dia inteiro na lanchonete`);
  console.log(`   ${BASE}`);
  console.log(`   mesas alvo=${MESAS_ALVO} · burst paralelo=${PARALLEL_BURST}\n`);

  section('0 · Saúde do servidor');
  {
    const { status } = await req('GET', '/api/config/pix', { soft: true });
    if (status !== 200) fail('servidor inacessível — suba o app ou ajuste BASE_URL');
    log('servidor responde');
  }
  await req('GET', '/', { expectStatus: 200, soft: true });
  const { data: pixCfg } = await req('GET', '/api/config/pix', { expectStatus: 200 });
  if (pixCfg?.chave) log(`PIX configurado`);
  else note('PIX_CHAVE ausente — avisos PIX limitados');

  section('1 · Cardápio e destaques');
  const { data: cardapio } = await req('GET', '/api/cardapio', { expectStatus: 200 });
  const produtos = extrairProdutos(cardapio);
  if (!produtos.length) fail('cardápio vazio — rode seed');
  const { cozinha: prodsCozinha, bar: prodsBar } = splitSetor(produtos);
  log(`${produtos.length} produtos · cozinha=${prodsCozinha.length} · bar=${prodsBar.length}`);
  if (!prodsCozinha.length) fail('nenhum produto de cozinha disponível');
  const { data: dest } = await req('GET', '/api/cardapio/destaques?limit=6', { expectStatus: 200 });
  log(`destaques: ${(dest?.itens || []).length}`);

  const pCoz1 = prodsCozinha[0];
  const pCoz2 = prodsCozinha[1] || prodsCozinha[0];
  const pBar1 = prodsBar[0] || null;

  section('2 · Auth (admin · cozinha · bar · caixa)');
  const admin = await login('admin');
  log(`admin → ${admin.staff?.papel}`);
  const cozinhaAuth = await login('cozinha');
  log(`cozinha → ${cozinhaAuth.staff?.papel}`);
  let barAuth = null;
  try {
    barAuth = await login('bar');
    log(`bar → ${barAuth.staff?.papel}`);
  } catch {
    note('login bar falhou — setores bar usarão cozinha/admin se necessário');
  }
  const caixaAuth = await login('caixa');
  log(`caixa → ${caixaAuth.staff?.papel}`);
  const { data: me } = await req('GET', '/api/me', { cookie: admin.cookie, expectStatus: 200 });
  if (!me?.staff) fail('/api/me sem staff', me);
  log('/api/me ok');

  section('3 · Mesas e garçons');
  const { data: mesas } = await req('GET', '/api/admin/mesas', {
    cookie: admin.cookie,
    expectStatus: 200,
  });
  if (!Array.isArray(mesas) || mesas.length < 2) fail('preciso de ≥2 mesas no seed');
  const livres = mesas
    .filter((m) => m.token && !m.sessaoAberta && !m.sessao_aberta)
    .sort((a, b) => Number(a.numero) - Number(b.numero));
  const pool = (livres.length >= 2 ? livres : mesas.filter((m) => m.token)).slice(0, MESAS_ALVO);
  if (pool.length < 2) fail('menos de 2 mesas utilizáveis', pool);
  log(`usando ${pool.length} mesas: ${pool.map((m) => '#' + m.numero).join(', ')}`);

  let { data: garcons } = await req('GET', '/api/admin/garcons', {
    cookie: admin.cookie,
    expectStatus: 200,
  });
  let garcom = (garcons || []).find((g) => g.ativo !== false && g.token);
  if (!garcom) {
    const created = await req('POST', '/api/admin/garcons', {
      cookie: admin.cookie,
      body: { nome: 'Dia Inteiro Tester' },
      expectStatus: 201,
      soft: true,
    });
    garcom = created.data;
  }
  if (!garcom?.token) fail('sem garçom com token');
  log(`garçom ${garcom.nome} token ok`);
  await req('GET', `/api/garcom/${garcom.token}/me`, { expectStatus: 200 });
  log('garçom /me ok');

  section('4 · Rush manhã — pedidos em paralelo em várias mesas');
  const pedidosPorMesa = new Map();
  await Promise.all(
    pool.map(async (mesa, idx) => {
      await req('POST', `/api/mesas/${mesa.token}/checkin`, {
        body: { clienteNome: `Cliente M${mesa.numero}` },
        expectStatus: 200,
        soft: true,
      });
      const items = [{ productId: pCoz1.id, qty: 1 + (idx % 2) }];
      if (pBar1 && idx % 2 === 0) items.push({ productId: pBar1.id, qty: 1 });
      if (idx % 3 === 0) items.push({ productId: pCoz2.id, qty: 1 });
      const { data: ped } = await req('POST', `/api/mesas/${mesa.token}/pedidos`, {
        body: { clienteNome: `Cliente M${mesa.numero}-A`, items },
        expectStatus: 201,
      });
      if (!ped?.id) fail(`pedido mesa ${mesa.numero}`, ped);
      stats.pedidos += 1;
      pedidosPorMesa.set(mesa.token, { mesa, pedidos: [ped], sessaoId: ped.sessaoId });
    })
  );
  log(`${stats.pedidos} pedidos criados em ${pool.length} mesas (paralelo)`);

  const mesaA = pool[0];
  section('5 · Mesa A — várias pessoas ao mesmo tempo');
  {
    const bursts = [];
    for (let i = 0; i < PARALLEL_BURST; i++) {
      bursts.push(
        req('POST', `/api/mesas/${mesaA.token}/pedidos`, {
          body: {
            clienteNome: `Convidado ${i + 1}`,
            items: [{ productId: (i % 2 === 0 ? pCoz1 : pCoz2).id, qty: 1 }],
          },
          expectStatus: 201,
        })
      );
    }
    const results = await Promise.all(bursts);
    const ids = results.map((r) => r.data?.id).filter(Boolean);
    const sessoes = new Set(results.map((r) => r.data?.sessaoId).filter((x) => x != null));
    if (ids.length !== PARALLEL_BURST) fail('burst incompleto', results.map((r) => r.data));
    if (sessoes.size !== 1) fail('burst deveria ser mesma sessão', [...sessoes]);
    stats.pedidos += ids.length;
    const entry = pedidosPorMesa.get(mesaA.token);
    entry.pedidos.push(...results.map((r) => r.data));
    log(`+${PARALLEL_BURST} pedidos na mesa #${mesaA.numero} · sessão #${[...sessoes][0]}`);
  }

  section('6 · Filas cozinha e bar');
  const { data: filaCoz } = await req('GET', '/api/cozinha/pedidos', {
    cookie: cozinhaAuth.cookie,
    expectStatus: 200,
  });
  log(`fila cozinha: ${Array.isArray(filaCoz) ? filaCoz.length : '?'} itens/pedidos`);
  if (barAuth) {
    const { data: filaBar } = await req('GET', '/api/bar/pedidos', {
      cookie: barAuth.cookie,
      expectStatus: 200,
      soft: true,
    });
    log(`fila bar: ${Array.isArray(filaBar) ? filaBar.length : '?'}`);
  }
  const { data: filaGar } = await req('GET', `/api/garcom/${garcom.token}/pedidos`, {
    expectStatus: 200,
  });
  log(`fila garçom: ${Array.isArray(filaGar) ? filaGar.length : '?'}`);

  section('7 · Produção concorrente');
  const allPeds = [];
  for (const v of pedidosPorMesa.values()) allPeds.push(...v.pedidos);
  await Promise.all(allPeds.map((ped) => avancarPedido(ped.id, cozinhaAuth.cookie)));
  log(`${allPeds.length} pedidos avançados até concluído`);

  section('8 · Entregas');
  {
    const entryA = pedidosPorMesa.get(mesaA.token);
    const primeiro = entryA.pedidos[0];
    const { status } = await req(
      'POST',
      `/api/garcom/${garcom.token}/pedidos/${primeiro.id}/entregar`,
      { body: {}, expectStatus: 200, soft: true }
    );
    if (status === 200) {
      stats.entregas += 1;
      log(`entrega pedido #${primeiro.id}`);
    } else note(`entrega #${primeiro.id} → HTTP ${status}`);

    const resto = allPeds.filter((p) => p.id !== primeiro.id);
    const entregas = await Promise.all(
      resto.map((p) =>
        req('POST', `/api/garcom/${garcom.token}/pedidos/${p.id}/entregar`, {
          expectStatus: 200,
          soft: true,
        })
      )
    );
    const ok = entregas.filter((e) => e.status === 200).length;
    stats.entregas += ok;
    log(`entregas restantes: ${ok}/${resto.length}`);
  }

  section('9 · Cancelar e editar pedido');
  if (pool.length >= 2) {
    const mesaB = pool[1];
    const { data: pedEdit } = await req('POST', `/api/mesas/${mesaB.token}/pedidos`, {
      body: { clienteNome: 'Vai Editar', items: [{ productId: pCoz1.id, qty: 1 }] },
      expectStatus: 201,
    });
    stats.pedidos += 1;
    const { status: stEdit } = await req('PUT', `/api/mesas/${mesaB.token}/pedidos/${pedEdit.id}`, {
      body: { items: [{ productId: pCoz2.id, qty: 2 }], clienteNome: 'Editado' },
      soft: true,
    });
    if (stEdit === 200) {
      stats.editados += 1;
      log(`pedido #${pedEdit.id} editado`);
    } else note(`edição → HTTP ${stEdit}`);

    const { data: pedCancel } = await req('POST', `/api/mesas/${mesaB.token}/pedidos`, {
      body: { clienteNome: 'Vai Cancelar', items: [{ productId: pCoz1.id, qty: 1 }] },
      expectStatus: 201,
    });
    stats.pedidos += 1;
    const { status: stDel } = await req('DELETE', `/api/mesas/${mesaB.token}/pedidos/${pedCancel.id}`, {
      soft: true,
    });
    if (stDel === 200) {
      stats.cancelados += 1;
      log(`pedido #${pedCancel.id} cancelado`);
    } else note(`cancelamento → HTTP ${stDel}`);

    if (pedEdit?.id) {
      try {
        await avancarPedido(pedEdit.id, cozinhaAuth.cookie);
        await req('POST', `/api/garcom/${garcom.token}/pedidos/${pedEdit.id}/entregar`, { soft: true });
        stats.entregas += 1;
      } catch (_) {}
    }
  } else note('só 1 mesa — pulou edição/cancelamento');

  section('10 · PIX avisos e confirmação no caixa');
  {
    const { data: sessao } = await req('GET', `/api/mesas/${mesaA.token}/sessao`, { expectStatus: 200 });
    const valor = Number(sessao.valorRestante || sessao.totalDevido || 0);
    if (valor > 0.01) {
      await req('POST', `/api/mesas/${mesaA.token}/pix-informado`, {
        body: { valor: Math.min(valor, valor / 2), clienteNome: 'Pagante 1' },
        expectStatus: 200,
        soft: true,
      });
      await req('POST', `/api/mesas/${mesaA.token}/pix-informado`, {
        body: { valor: Math.min(valor, valor / 3), clienteNome: 'Pagante 2' },
        expectStatus: 200,
        soft: true,
      });
      stats.pix += 2;
      log('dois avisos PIX enviados (mesa A)');

      const { data: sessoes } = await req('GET', '/api/caixa/sessoes', {
        cookie: caixaAuth.cookie,
        expectStatus: 200,
      });
      const sCx = (sessoes || []).find((s) => s.id === sessao.sessaoId || s.mesa === mesaA.numero);
      if (sCx) {
        const avisos = (sCx.pixAvisos || []).filter((a) => a.status === 'pendente' || !a.status);
        for (const av of avisos.slice(0, 2)) {
          const { status } = await req(
            'POST',
            `/api/caixa/sessoes/${sCx.id}/pix-avisos/${av.id}/confirmar`,
            { cookie: caixaAuth.cookie, body: {}, soft: true }
          );
          if (status === 200) log(`caixa confirmou aviso #${av.id}`);
          else note(`confirmar aviso #${av.id} → HTTP ${status}`);
        }
      } else note('sessão A não listada no caixa para confirmar PIX');
    } else note('mesa A sem valor residual — PIX pulado');
  }

  section('11 · Caixa — divisão, desconto/taxa, fechar');
  {
    const { data: sessoes } = await req('GET', '/api/caixa/sessoes', {
      cookie: caixaAuth.cookie,
      expectStatus: 200,
    });
    const abertas = sessoes || [];
    log(`${abertas.length} sessão(ões) abertas no caixa`);
    for (const s of abertas) {
      const restante = Number(s.valorRestante != null ? s.valorRestante : s.valorTotal || 0);
      if (restante > 1) {
        const parte = Number(Math.max(0.01, Math.floor(restante * 30) / 100).toFixed(2));
        const { status } = await req('POST', `/api/caixa/sessoes/${s.id}/pagamentos`, {
          cookie: caixaAuth.cookie,
          body: { valor: parte, formaPagamento: 'pix' },
          soft: true,
        });
        if (status === 201 || status === 200) log(`parcial sessão #${s.id} R$ ${parte.toFixed(2)}`);
      }
      const { status: stF } = await req('POST', `/api/caixa/sessoes/${s.id}/fechar`, {
        cookie: caixaAuth.cookie,
        body: {
          formaPagamento: 'dinheiro',
          desconto: s === abertas[0] ? 1 : 0,
          taxaServico: s === abertas[0] ? 2 : 0,
        },
        soft: true,
      });
      if (stF === 200) {
        stats.fechamentos += 1;
        log(`sessão #${s.id} fechada`);
      } else if (stF === 409) note(`sessão #${s.id} bloqueada (pedidos em andamento)`);
      else note(`fechar #${s.id} → HTTP ${stF}`);
    }
  }

  section('12 · Admin — dashboard e relatório');
  {
    const { status: stD } = await req('GET', '/api/admin/dashboard', {
      cookie: admin.cookie,
      soft: true,
    });
    if (stD === 200) log('dashboard ok');
    else note(`dashboard → HTTP ${stD}`);
    /* /api/admin/relatorio exige from e to (YYYY-MM-DD) — o front sempre manda.
       Chamado sem parâmetros devolve 400 por contrato, o que aparecia aqui como
       falso aviso de falha. */
    const hoje = new Date().toISOString().slice(0, 10);
    const { status: stR } = await req('GET', `/api/admin/relatorio?from=${hoje}&to=${hoje}`, {
      cookie: admin.cookie,
      soft: true,
    });
    if (stR === 200) log('relatório ok');
    else note(`relatório → HTTP ${stR}`);
    await req('GET', '/api/admin/cardapio', { cookie: admin.cookie, soft: true });
    log('admin cardápio consultado');
    const { data: mesasFim } = await req('GET', '/api/admin/mesas', {
      cookie: admin.cookie,
      expectStatus: 200,
    });
    const aindaAbertas = (mesasFim || []).filter((m) => m.sessaoAberta || m.sessao_aberta);
    if (aindaAbertas.length)
      note(`${aindaAbertas.length} mesa(s) ainda abertas: ${aindaAbertas.map((m) => m.numero).join(', ')}`);
    else log('mesas do pool sem sessão aberta (ou já liberadas)');
  }

  section('13 · Logout');
  await req('POST', '/api/logout', { cookie: admin.cookie, expectStatus: 200, soft: true });
  log('logout admin');

  const ms = Date.now() - t0;
  console.log('\n════════════════════════════════════════');
  console.log('  Resumo do dia');
  console.log(`     pedidos criados : ${stats.pedidos}`);
  console.log(`     entregas        : ${stats.entregas}`);
  console.log(`     avisos PIX      : ${stats.pix}`);
  console.log(`     editados        : ${stats.editados}`);
  console.log(`     cancelados      : ${stats.cancelados}`);
  console.log(`     fechamentos     : ${stats.fechamentos}`);
  console.log(`     passos HTTP     : ${step}`);
  console.log(`     duração         : ${(ms / 1000).toFixed(1)}s`);
  console.log('════════════════════════════════════════');

  if (issues.length) {
    console.log(`\n⚠ Terminou com ${issues.length} aviso(s) (não-fatais):`);
    issues.forEach((i) => console.log('  - ' + i));
    console.log('\n✅ SUPER TESTE concluiu (com avisos). Revise os ⚠ acima.\n');
  } else {
    console.log('\n✅ SUPER TESTE OK — dia inteiro sobreviveu ao rush.\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

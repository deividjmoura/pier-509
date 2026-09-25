#!/usr/bin/env node
/**
 * Teste de carga e concorrência contra um servidor REAL (não mock).
 *
 * Cenários:
 *   1. Burst — 10 pedidos simultâneos na MESMA mesa (limite do rate-limit):
 *      todos devem criar pedido e apenas 1 sessão pode existir (ADR-005).
 *   2. N mesas em paralelo — ciclo completo (checkin → pedido → cozinha →
 *      entrega → PIX) com reconciliação contábil item a item.
 *   3. Estoque sob corrida — 12 pedidos simultâneos do mesmo produto com
 *      estoque 5, vindos de mesas diferentes: nunca pode vender mais que 5.
 *   4. Fechamento duplo simultâneo — só um vence, o outro leva 409.
 *   5. Pagamentos parciais simultâneos — a soma nunca ultrapassa a conta.
 *   6. Auditoria SQL — invariários verificados direto no PostgreSQL.
 *
 * Uso:
 *   BASE_URL=http://127.0.0.1:3000 STAFF_SEED_PASSWORD=... node scripts/teste-carga.js
 *   MESAS=12 CONCORRENCIA=6 npm run test:carga
 *
 * Requer DATABASE_URL para o cenário 6 (auditoria direta no banco).
 */
require('dotenv').config();

const BASE = (process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
const SENHA = process.env.STAFF_SEED_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';
const N_MESAS = Number(process.env.MESAS || 12);
const CONCORRENCIA = Number(process.env.CONCORRENCIA || 6);

const falhas = [];
const avisos = [];
let verificados = 0;

const ok = (m) => { verificados += 1; console.log(`  \u2713 ${m}`); };
const ruim = (m) => { falhas.push(m); console.error(`  \u2717 ${m}`); };
const nota = (m) => { avisos.push(m); console.log(`  ! ${m}`); };
const secao = (m) => console.log(`\n  \u2500\u2500 ${m} \u2500\u2500`);
const BRL = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

function cookieDe(setCookies) {
  return setCookies.map((c) => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
}

async function req(method, path, { body, cookie, origem } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (origem) headers.Origin = origem;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  const setCookie = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  return { status: res.status, data, setCookie };
}

/** Roda `n` tarefas com até `concorrencia` em voo ao mesmo tempo. */
async function emLote(n, concorrencia, tarefa) {
  const resultados = new Array(n);
  let proximo = 0;
  async function trabalhador() {
    while (proximo < n) {
      const i = proximo++;
      resultados[i] = await tarefa(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, n) }, trabalhador));
  return resultados;
}

async function login(usuario) {
  const r = await req('POST', '/api/login', { body: { usuario, senha: SENHA }, origem: BASE });
  if (r.status !== 200) throw new Error(`login ${usuario} falhou: ${r.status} ${JSON.stringify(r.data)}`);
  return cookieDe(r.setCookie);
}

async function mesasLivres(adminCookie, quantidade) {
  const r = await req('GET', '/api/admin/mesas', { cookie: adminCookie });
  if (r.status !== 200) throw new Error('não consegui listar mesas');
  const livres = r.data.filter((m) => !m.sessaoAberta);
  if (livres.length < quantidade) {
    throw new Error(`preciso de ${quantidade} mesas livres, há ${livres.length}. Feche as sessões anteriores.`);
  }
  return livres.slice(0, quantidade);
}

async function cardapio() {
  const r = await req('GET', '/api/cardapio');
  const produtos = r.data.flatMap((c) => c.produtos || []);
  if (!produtos.length) throw new Error('cardápio vazio — rode npm run db:seed');
  return produtos;
}

/** Leva o pedido até "entregue" (cozinha → concluído → garçom). */
async function entregar(pedidoId, cookies) {
  const passos = [];
  for (const st of ['em_producao', 'concluido']) {
    const r = await req('PATCH', `/api/pedidos/${pedidoId}/status`, {
      cookie: cookies.cozinha, body: { status: st }, origem: BASE,
    });
    if (r.status !== 200) passos.push(`status→${st} ${r.status}`);
  }
  const g = await req('POST', `/api/garcom/${cookies.garcomToken}/pedidos/${pedidoId}/entregar`, { body: {} });
  if (g.status !== 200) passos.push(`entrega ${g.status}: ${JSON.stringify(g.data).slice(0, 90)}`);
  return passos;
}

/* ------------------------------------------------------------------ */
async function cenarioBurst(mesa, produto) {
  secao(`1. Burst: 10 pedidos simultâneos na mesa ${mesa.numero}`);
  const N = 10; // teto do rate-limit por IP+mesa; acima disso vira 429, não corrida
  const respostas = await emLote(N, N, () =>
    req('POST', `/api/mesas/${mesa.token}/pedidos`, {
      body: { clienteNome: 'Cliente Burst', items: [{ productId: produto.id, qty: 1 }] },
    })
  );
  const criados = respostas.filter((r) => r.status === 201);
  const errados = respostas.filter((r) => r.status !== 201 && r.status !== 429);

  if (errados.length) ruim(`${errados.length} pedido(s) com status inesperado: ${errados.map((e) => e.status).join(', ')}`);
  else ok(`${criados.length}/${N} pedidos criados sob concorrência real`);

  const sessoes = [...new Set(criados.map((r) => r.data?.sessaoId).filter(Boolean))];
  if (sessoes.length === 1) ok(`1 única sessão sob corrida (id ${sessoes[0]}) — trava FOR UPDATE ok`);
  else if (!sessoes.length) ruim('nenhuma sessão foi criada');
  else ruim(`CORRIDA: ${sessoes.length} sessões distintas para a mesma mesa (${sessoes.join(', ')})`);

  const s = await req('GET', `/api/mesas/${mesa.token}/sessao`);
  const nPedidos = (s.data?.pedidos || []).length;
  if (nPedidos === criados.length) ok(`sessão reporta ${nPedidos} pedidos = pedidos criados`);
  else ruim(`sessão reporta ${nPedidos} pedidos, mas ${criados.length} foram criados`);

  return { sessaoId: sessoes[0], pedidos: criados.map((r) => r.data.id) };
}

/* ------------------------------------------------------------------ */
async function cenarioMesas(mesas, produtos, cookies) {
  secao(`2. ${mesas.length} mesas em paralelo · ciclo completo (concorrência ${CONCORRENCIA})`);

  return emLote(mesas.length, CONCORRENCIA, async (i) => {
    const mesa = mesas[i];
    const erros = [];
    const sorteio = [produtos[i % produtos.length], produtos[(i * 7 + 3) % produtos.length]];
    const esperado = [];

    const chk = await req('POST', `/api/mesas/${mesa.token}/checkin`, {
      body: { clienteNome: `Mesa ${mesa.numero}` },
    });
    if (chk.status !== 200) erros.push(`checkin ${chk.status}`);

    const ids = [];
    for (let k = 0; k < 2; k++) {
      const prod = sorteio[k];
      const qtd = k + 1;
      esperado.push(Number(prod.preco) * qtd);
      const p = await req('POST', `/api/mesas/${mesa.token}/pedidos`, {
        body: { clienteNome: `Mesa ${mesa.numero}`, items: [{ productId: prod.id, qty: qtd, note: `obs ${k}` }] },
      });
      if (p.status === 201) ids.push(p.data.id);
      else erros.push(`pedido ${p.status}: ${JSON.stringify(p.data).slice(0, 110)}`);
    }
    if (ids.length !== 2) return { mesa, erros, totalEsperado: 0, sessaoId: null };

    for (const pid of ids) erros.push(...(await entregar(pid, cookies)));

    const sessao = await req('GET', `/api/mesas/${mesa.token}/sessao`);
    const totalEsperado = Number(esperado.reduce((a, b) => a + b, 0).toFixed(2));
    const totalReal = Number(sessao.data?.totalDevido ?? NaN);
    if (!(Math.abs(totalReal - totalEsperado) <= 0.011)) {
      erros.push(`total ${BRL(totalReal)} ≠ soma dos itens ${BRL(totalEsperado)}`);
    }

    const pix = await req('POST', `/api/mesas/${mesa.token}/pix-informado`, { body: {} });
    if (pix.status !== 200) erros.push(`pix-informado ${pix.status}: ${JSON.stringify(pix.data).slice(0, 110)}`);

    return { mesa, erros, totalEsperado, sessaoId: sessao.data?.sessaoId, avisoId: pix.data?.avisoId, pedidoIds: ids };
  }).then((resumo) => {
    const comErro = resumo.filter((r) => r.erros.length);
    if (comErro.length) comErro.forEach((r) => ruim(`mesa ${r.mesa.numero}: ${r.erros.join(' | ')}`));
    else ok(`${resumo.length} mesas completaram o ciclo sem erro`);
    const soma = resumo.reduce((a, r) => a + (r.totalEsperado || 0), 0);
    ok(`faturamento das ${resumo.length} mesas: ${BRL(soma)}`);
    return resumo;
  });
}

/* ------------------------------------------------------------------ */
async function cenarioEstoque(adminCookie, mesas, cookies) {
  secao('3. Estoque sob corrida (produto com estoque 5, 12 pedidos simultâneos)');

  const cat = await req('GET', '/api/admin/cardapio', { cookie: adminCookie });
  const categoriaId = cat.data?.[0]?.id;
  if (!categoriaId) return nota('sem categoria para criar produto de teste');

  const criado = await req('POST', '/api/admin/produtos', {
    cookie: adminCookie, origem: BASE,
    body: { nome: `Teste Carga ${Date.now()}`, categoriaId, preco: 10, controlaEstoque: true, estoque: 5 },
  });
  if (criado.status !== 201) return nota(`não consegui criar produto de estoque (${criado.status})`);
  const produtoId = criado.data.id;

  // mesas diferentes para o rate-limit por mesa não mascarar a corrida de estoque
  const respostas = await emLote(mesas.length, mesas.length, (i) =>
    req('POST', `/api/mesas/${mesas[i].token}/pedidos`, {
      body: { clienteNome: 'Caçador de estoque', items: [{ productId: produtoId, qty: 1 }] },
    })
  );
  const aceitos = respostas.filter((r) => r.status === 201);
  const rejeitados = respostas.filter((r) => r.status === 400);

  if (aceitos.length === 5) ok(`exatamente 5 de ${mesas.length} aceitos com estoque=5 (${rejeitados.length} rejeitados)`);
  else ruim(`estoque vazou: ${aceitos.length} pedidos aceitos com estoque inicial 5`);

  const depois = await req('GET', '/api/admin/cardapio', { cookie: adminCookie });
  const p = depois.data.flatMap((c) => c.produtos || []).find((x) => x.id === produtoId);
  const estoqueFinal = Number(p?.estoque ?? NaN);
  if (estoqueFinal === 0) ok('estoque final = 0 (sem saldo negativo)');
  else ruim(`estoque final = ${estoqueFinal}, esperado 0`);

  // devolve o estoque cancelando os pedidos ainda em "recebido"
  for (const a of aceitos) {
    const t = mesas.find((m) => m.token && a.data?.mesa === m.numero);
    if (t) await req('DELETE', `/api/mesas/${t.token}/pedidos/${a.data.id}`, {});
  }
  await req('DELETE', `/api/admin/produtos/${produtoId}`, { cookie: adminCookie, origem: BASE });
  return { aceitos: aceitos.length, estoqueFinal, produtoId };
}

/* ------------------------------------------------------------------ */
async function cenarioFechamentoDuplo(caixaCookie, alvo) {
  secao('4. Dois fechamentos simultâneos da mesma sessão');
  if (!alvo) return nota('nenhuma sessão disponível');
  const [a, b] = await Promise.all([
    req('POST', `/api/caixa/sessoes/${alvo}/fechar`, {
      cookie: caixaCookie, origem: BASE, body: { formaPagamento: 'pix', desconto: 0, taxaServico: 0 },
    }),
    req('POST', `/api/caixa/sessoes/${alvo}/fechar`, {
      cookie: caixaCookie, origem: BASE, body: { formaPagamento: 'dinheiro', desconto: 0, taxaServico: 0 },
    }),
  ]);
  const venceu = [a, b].filter((r) => r.status === 200).length;
  const conflito = [a, b].filter((r) => r.status === 409).length;
  if (venceu === 1 && conflito === 1) ok('1 venceu, o outro levou 409 (sem dupla baixa)');
  else ruim(`fechamento duplo: vencedores=${venceu} conflitos=${conflito} (a=${a.status} b=${b.status})`);
}

/* ------------------------------------------------------------------ */
async function cenarioPagamentosParalelos(caixaCookie, sessaoId, total) {
  secao('5. 6 pagamentos parciais simultâneos na mesma sessão');
  if (!sessaoId) return nota('nenhuma sessão aberta restante');
  const parcela = Number((total / 6).toFixed(2));
  const respostas = await emLote(6, 6, () =>
    req('POST', `/api/caixa/sessoes/${sessaoId}/pagamentos`, {
      cookie: caixaCookie, origem: BASE, body: { valor: parcela, formaPagamento: 'pix' },
    })
  );
  const aceitos = respostas.filter((r) => r.status === 201);
  const somado = Number(aceitos.reduce((a, r) => a + Number(r.data?.valor ?? parcela), 0).toFixed(2));
  if (somado <= total + 0.02) ok(`${aceitos.length} aceitos somando ${BRL(somado)} ≤ conta ${BRL(total)}`);
  else ruim(`pagamentos somados ${BRL(somado)} excedem a conta ${BRL(total)}`);
}

/* ------------------------------------------------------------------ */
async function auditoriaSql() {
  secao('6. Auditoria SQL (invariantes verificados direto no PostgreSQL)');
  if (!process.env.DATABASE_URL) return nota('DATABASE_URL ausente — auditoria SQL pulada');
  let pool;
  try { pool = require('../db/pool'); } catch (e) { return nota('pool indisponível: ' + e.message); }

  const checagens = [
    ['nenhuma mesa com 2+ sessões abertas',
      `SELECT COUNT(*)::int n FROM (
         SELECT mesa_id FROM mesa_sessoes WHERE status='aberta'
         GROUP BY mesa_id HAVING COUNT(*) > 1) x`, 0],
    ['nenhum estoque negativo',
      `SELECT COUNT(*)::int n FROM produtos WHERE controla_estoque AND estoque < 0`, 0],
    ['nenhum pagamento com valor <= 0 ou NaN',
      `SELECT COUNT(*)::int n FROM sessao_pagamentos WHERE valor IS NULL OR valor <= 0`, 0],
    ['nenhuma sessão fechada com pedido não entregue',
      `SELECT COUNT(*)::int n FROM pedidos p JOIN mesa_sessoes s ON s.id=p.sessao_id
       WHERE s.status='fechada' AND p.status<>'entregue' AND p.status<>'cancelado'`, 0],
    ['nenhum item de pedido apontando para pedido inexistente',
      `SELECT COUNT(*)::int n FROM itens_pedido ip
       LEFT JOIN pedidos p ON p.id=ip.pedido_id WHERE p.id IS NULL`, 0],
    ['nenhum aviso PIX órfão de sessão',
      `SELECT COUNT(*)::int n FROM pix_avisos pa
       LEFT JOIN mesa_sessoes s ON s.id=pa.sessao_id WHERE s.id IS NULL`, 0],
    ['nenhum valor_total de sessão divergente da soma dos itens entregues',
      `SELECT COUNT(*)::int n FROM mesa_sessoes s
       WHERE s.status='aberta' AND ABS(
         COALESCE(s.valor_total,0) -
         COALESCE((SELECT SUM(ip.quantidade*(ip.preco_unitario +
             COALESCE((SELECT SUM(a.preco_unitario) FROM itens_pedido_adicionais a
                       WHERE a.item_pedido_id=ip.id),0)))
           FROM itens_pedido ip JOIN pedidos p ON p.id=ip.pedido_id
           WHERE p.sessao_id=s.id AND p.status='entregue'),0)) > 0.02`, 0],
    ['nenhum pagamento acumulado acima do valor cobrado da sessão fechada',
      `SELECT COUNT(*)::int n FROM mesa_sessoes s
       WHERE s.status='fechada' AND
         COALESCE((SELECT SUM(valor) FROM sessao_pagamentos WHERE sessao_id=s.id),0)
         > COALESCE(s.valor_cobrado, s.valor_total, 0) + 0.05`, 0],
  ];

  for (const [rotulo, sql, esperado] of checagens) {
    try {
      const { rows } = await pool.query(sql);
      const n = Number(rows[0].n);
      if (n === esperado) ok(rotulo);
      else ruim(`${rotulo} — encontrado ${n}, esperado ${esperado}`);
    } catch (e) {
      ruim(`${rotulo} — consulta falhou: ${e.message}`);
    }
  }
  await pool.end();
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log(`\n\u{1F9EA} Teste de carga · ${BASE}`);
  console.log(`   mesas=${N_MESAS} · concorrência=${CONCORRENCIA}\n`);

  const health = await req('GET', '/api/cardapio');
  if (health.status !== 200) {
    console.error(`\u2717 servidor não respondeu em ${BASE} (status ${health.status})`);
    process.exit(1);
  }

  const admin = await login('admin');
  const cozinha = await login('cozinha');
  const caixa = await login('caixa');
  const garcons = await req('GET', '/api/admin/garcons', { cookie: admin });
  const garcomToken = garcons.data?.[0]?.token;
  if (!garcomToken) throw new Error('nenhum garçom no banco — rode npm run db:seed');
  const cookies = { admin, cozinha, caixa, garcomToken };
  const produtos = await cardapio();

  // 1 mesa para o burst + N_MESAS para o ciclo + N_MESAS para o estoque
  const todas = await mesasLivres(admin, 1 + N_MESAS * 2);
  const [mesaBurst] = todas;
  const mesasCiclo = todas.slice(1, 1 + N_MESAS);
  const mesasEstoque = todas.slice(1 + N_MESAS, 1 + N_MESAS * 2);

  const burst = await cenarioBurst(mesaBurst, produtos[0]);
  if (burst.sessaoId) {
    for (const pid of burst.pedidos) await entregar(pid, cookies);
    await req('POST', `/api/caixa/sessoes/${burst.sessaoId}/fechar`, {
      cookie: caixa, origem: BASE, body: { formaPagamento: 'dinheiro' },
    });
  }

  const resumos = await cenarioMesas(mesasCiclo, produtos, cookies);
  await cenarioEstoque(admin, mesasEstoque, cookies);

  const comSessao = resumos.filter((r) => r.sessaoId);
  await cenarioFechamentoDuplo(caixa, comSessao[0]?.sessaoId);
  if (comSessao[1]) await cenarioPagamentosParalelos(caixa, comSessao[1].sessaoId, comSessao[1].totalEsperado);

  secao('Limpeza');
  const abertas = await req('GET', '/api/caixa/sessoes', { cookie: caixa });
  let fechadas = 0;
  const ativos = await req('GET', '/api/admin/pedidos?ativos=1&limit=500', { cookie: admin });
  for (const p of ativos.data || []) {
    if (p.status === 'entregue') continue;
    await entregar(p.id, cookies);
  }
  for (const s of abertas.data || []) {
    const f = await req('POST', `/api/caixa/sessoes/${s.id}/fechar`, {
      cookie: caixa, origem: BASE, body: { formaPagamento: 'pix' },
    });
    if (f.status === 200) fechadas++;
  }
  ok(`${fechadas} sessão(ões) remanescente(s) fechada(s)`);

  await auditoriaSql();

  console.log('\n' + '\u2500'.repeat(34));
  console.log(`verificações: ${verificados} · avisos: ${avisos.length} · FALHAS: ${falhas.length}`);
  if (falhas.length) {
    console.log('\nFALHAS:');
    falhas.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\u2705 Carga e concorrência OK.');
}

main().catch((e) => {
  console.error('\n\u2717 teste abortado:', e && e.stack ? e.stack : e);
  process.exit(1);
});

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const { getCardapio, invalidarCardapio } = require('./db/cardapio');
const {
  criarPedido,
  getSessao,
  getFilaCozinha,
  getFilaBar,
  getFilaGarcom,
  checkinCliente,
  cancelarPedidoCliente,
  editarPedidoCliente,
  setStatusItem,
  setStatusPedido,
  avancarStatusItem,
  ErroPedido,
} = require('./db/pedidos');
const { informarPixPago, ErroPixCliente } = require('./db/pix-cliente');
const {
  ErroAdmin,
  listMesas,
  getCardapioAdmin,
  criarCategoria,
  atualizarCategoria,
  removerCategoria,
  reordenarCategorias,
  criarProduto,
  atualizarProduto,
  reordenarProdutos,
  criarAdicional,
  removerAdicional,
  setRemoviveis,
  removerProduto,
} = require('./db/admin');
const {
  listSessoesAbertas,
  fecharSessao,
  registrarPagamento,
  confirmarPixAviso,
  ErroCaixa,
} = require('./db/caixa');
const {
  SESSION_COOKIE,
  ErroAuth,
  parseCookies,
  cookieDeSessao,
  cookieDeLogout,
  autenticar,
  criarSessao,
  destruirSessao,
  getStaffDaRequisicao,
  exigirAcesso,
  homeDoPapel,
  garantirStaffSeed,
} = require('./db/auth');
const { golpePermitido, golpeExcedido, registrarGolpe, limparGolpes } = require('./db/rateLimit');
const { normalizarChavePix, inspecionarChavePix } = require('./db/pix-normaliza');
const { subscribe, broadcast } = require('./db/events');
const pool = require('./db/pool');
const { getMesaPorToken } = require('./db/queries');
const { eventAccess } = require('./db/event-access');
const {
  ErroGarcom,
  listGarcons,
  criarGarcom,
  setGarcomAtivo,
  removerGarcom,
  getGarcomPorToken,
  entregarComoGarcom,
  listPedidosRecentes,
} = require('./db/garcons');
const { resumoDia, topProdutosHoje } = require('./db/dashboard');
const { relatorioVendas } = require('./db/relatorio');
const { purgeHistorico, ErroPurge } = require('./db/purge');
const { processarUploadFoto, ErroFoto } = require('./db/foto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 128 * 1024);

function clientIp(req) {
  if (process.env.NODE_ENV === 'production') {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      return xff.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (!res.getHeader('Content-Security-Policy')) {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data: blob: https:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
        "frame-src 'self' blob:",
        "child-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
  }
}

/* Cache por tipo de arquivo: assets do Vite têm hash no nome (nunca mudam),
   imagens/ícones mudam raramente e HTML precisa ser sempre fresco. Antes tudo
   saía com no-store e a equipe rebaixava ~1,3 MB de app a cada navegação. */
function cachePara(caminho) {
  const ext = path.extname(caminho).toLowerCase();
  if (caminho.includes(`${path.sep}assets${path.sep}`) && /-[A-Za-z0-9_-]{8}\./.test(caminho)) {
    return 'public, max-age=31536000, immutable';
  }
  if (ext === '.html') return 'no-store';
  if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.ico', '.svg', '.woff', '.woff2', '.ttf'].includes(ext)) {
    return 'public, max-age=604800, stale-while-revalidate=86400';
  }
  if (ext === '.json' || ext === '.webmanifest') return 'public, max-age=3600';
  if (ext === '.js' || ext === '.css') return 'public, max-age=600, must-revalidate';
  return 'no-store';
}

function send(res, status, type, body, extraHeaders) {
  applySecurityHeaders(res);
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  // Permite sobrescrever Cache-Control (ex.: cardápio público com max-age curto)
  if (extraHeaders && typeof extraHeaders === 'object') {
    Object.assign(headers, extraHeaders);
  } else {
    try {
      const prev = res.getHeader('Cache-Control');
      if (prev) headers['Cache-Control'] = prev;
    } catch (_) {}
  }
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, obj, extraHeaders) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), extraHeaders);
}
function body(req, opts) {
  const limit = (opts && opts.maxBytes) || MAX_BODY_BYTES;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let estourou = false;
    let resolvida = false;

    req.on('data', (c) => {
      if (estourou) return; // já rejeitado: só drena o resto sem guardar
      size += c.length;
      if (size > limit) {
        /* Antes isto chamava req.destroy(): o socket morria ANTES do handler
           escrever a resposta e o cliente via "conexão resetada" em vez de
           413 — e a escrita seguinte caía num socket morto. Agora liberamos o
           corpo sem reter memória e deixamos o handler responder direito. */
        estourou = true;
        chunks.length = 0;
        resolvida = true;
        const err = new Error('Payload too large');
        err.status = 413;
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (resolvida) return;
      resolvida = true;
      try {
        const s = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(s || '{}'));
      } catch (e) {
        const err = new Error('JSON inválido');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', (e) => {
      if (resolvida) return;
      resolvida = true;
      reject(e);
    });
  });
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const p = u.pathname;

    /* Diretório não é página: /assets/marca/ respondia o HTML do app (200) e
       escondia link quebrado. Melhor um 404 explícito. */
    if (p.length > 1 && p.endsWith('/')) {
      return send(res, 404, 'text/plain; charset=utf-8', '404');
    }

    if (p === '/api/cardapio' && req.method === 'GET') {
      return json(res, 200, await getCardapio(), {
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=60',
      });
    }
    if (p === '/api/cardapio/destaques' && req.method === 'GET') {
      const limit = Number(u.searchParams.get('limit') || 6);
      return json(res, 200, { itens: await topProdutosHoje(limit) });
    }

    let m;
    if (p === '/api/events' && req.method === 'GET') {
      const access = await eventAccess(u.searchParams, {
        staff: await getStaffDaRequisicao(req),
        findMesa: (token) => getMesaPorToken(pool, token),
        findGarcom: getGarcomPorToken,
      });
      if (!access) {
        return json(res, 401, { error: 'SSE requer staff autenticado ou token válido de mesa/garçom' });
      }

      applySecurityHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (req.socket && typeof req.socket.setTimeout === 'function') {
        req.socket.setTimeout(0);
      }
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, at: Date.now() })}\n\n`);
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      subscribe(res, { publicClient: access === 'public' });
      const hb = setInterval(() => {
        try {
          res.write(`: ping ${Date.now()}\n\n`);
        } catch (_) {
          clearInterval(hb);
        }
      }, 15000);
      req.on('close', () => {
        clearInterval(hb);
      });
      return;
    }

    if ((m = p.match(/^\/api\/mesas\/([^/]+)\/pedidos$/)) && req.method === 'POST') {
      const ip = clientIp(req);
      /* 20 por mesa em 5 min cobre mesa grande pedindo em rodadas; o teto por
         IP (60) mantém a proteção contra script martelando o endpoint. */
      const dentroDaMesa = golpePermitido(`pedido:${ip}:${m[1]}`, { janelaMs: 5 * 60 * 1000, max: 20 });
      const dentroDoIp = dentroDaMesa && golpePermitido(`pedido-ip:${ip}`, { janelaMs: 5 * 60 * 1000, max: 60 });
      if (!dentroDaMesa || !dentroDoIp) {
        return json(res, 429, { error: 'Muitos pedidos em pouco tempo. Aguarde um instante.' });
      }
      try {
        const pedido = await criarPedido(m[1], await body(req));
        broadcast('update', { type: 'pedido_criado', pedidoId: pedido.id, mesaToken: m[1] });
        return json(res, 201, pedido);
      } catch (e) {
        if (e instanceof ErroPedido) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/mesas\/([^/]+)\/checkin$/)) && req.method === 'POST') {
      try {
        const out = await checkinCliente(m[1], await body(req));
        broadcast('update', { type: 'checkin', mesaToken: m[1], clienteNome: out.clienteNome });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroPedido) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/mesas\/([^/]+)\/sessao$/)) && req.method === 'GET') {
      try {
        return json(res, 200, await getSessao(m[1]));
      } catch (e) {
        if (e instanceof ErroPedido) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/mesas\/([^/]+)\/pix-informado$/)) && req.method === 'POST') {
      try {
        /* JSON malformado é erro do cliente: sem este catch voraz a rota
           executava a lógica de PIX com payload inventado ({}). */
        const payload = await body(req);
        const out = await informarPixPago(m[1], payload);
        broadcast('update', {
          type: 'pix_informado',
          mesaToken: m[1],
          sessaoId: out.sessaoId,
          avisoId: out.avisoId,
          pedidoId: out.pedidoId,
          valorAvisado: out.valorAvisado,
        });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroPixCliente) return json(res, e.status, { error: e.message });
        // ErroValidacao (400) e corpo acima do limite (413) também saem como erro de cliente.
        if (e && (e.status === 400 || e.status === 413)) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/mesas\/([^/]+)\/pedidos\/(\d+)$/)) && req.method === 'DELETE') {
      try {
        const out = await cancelarPedidoCliente(m[1], Number(m[2]));
        broadcast('update', { type: 'pedido_cancelado', pedidoId: Number(m[2]), mesaToken: m[1] });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroPedido) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/mesas\/([^/]+)\/pedidos\/(\d+)$/)) && req.method === 'PUT') {
      try {
        const out = await editarPedidoCliente(m[1], Number(m[2]), await body(req));
        broadcast('update', { type: 'pedido_editado', pedidoId: Number(m[2]), mesaToken: m[1] });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroPedido) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if (p === '/api/garcom/pedidos' && req.method === 'GET') {
      return json(res, 401, { error: 'Use /api/garcom/:token/pedidos com o link do garçom' });
    }
    if ((m = p.match(/^\/api\/garcom\/([^/]+)\/me$/)) && req.method === 'GET') {
      const g = await getGarcomPorToken(m[1]);
      if (!g || !g.ativo) return json(res, 401, { error: 'Link inválido ou desativado' });
      return json(res, 200, { id: g.id, nome: g.nome });
    }
    if ((m = p.match(/^\/api\/garcom\/([^/]+)\/pedidos$/)) && req.method === 'GET') {
      const g = await getGarcomPorToken(m[1]);
      if (!g || !g.ativo) return json(res, 401, { error: 'Link inválido ou desativado' });
      return json(res, 200, await getFilaGarcom());
    }
    if ((m = p.match(/^\/api\/garcom\/([^/]+)\/pedidos\/(\d+)\/entregar$/)) && req.method === 'POST') {
      try {
        /* body(req) já devolve {} quando não há corpo; o catch voraz transformava
           JSON quebrado em "entregar tudo". Sem ele, 400 honesto. */
        const payload = await body(req);
        const itemIds = payload && (payload.itemIds || payload.itens || payload.ids);
        const out = await entregarComoGarcom(Number(m[2]), m[1], itemIds || null);
        broadcast('update', {
          type: 'status_alterado',
          pedidoId: Number(m[2]),
          status: out.status,
          itensEntregues: out.itensEntregues,
          parcial: out.parcial,
          garcom: out.garcom?.nome,
        });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroGarcom) return json(res, e.status, { error: e.message });
        if (e && (e.status === 400 || e.status === 413)) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    /* Health check da plataforma (Railway/Render/Docker): sem sessão, sem
       vazar nada — responde se o processo está de pé e se o banco responde. */
    if ((p === '/healthz' || p === '/api/health') && req.method === 'GET') {
      let banco = 'ok';
      try {
        await Promise.race([
          pool.query('SELECT 1'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
        ]);
      } catch (e) {
        banco = 'indisponivel';
      }
      const ok = banco === 'ok';
      return json(res, ok ? 200 : 503, {
        ok,
        app: 'pier509',
        banco,
        uptime_s: Math.round(process.uptime()),
        em: new Date().toISOString(),
      });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      /* O limite existe para barrar força bruta — então conta SENHA ERRADA,
         não tentativa. Antes contava tudo: com toda a equipe saindo pelo mesmo
         IP da loja, o 9º login legítimo do turno era bloqueado por 5 minutos
         como se fosse ataque. Limites: 10 falhas por IP em 15 min (bloqueia) e
         30 falhas por usuário+IP em 15 min (evita spray em vários IPs). */
      const JANELA_FALHAS = 10 * 60 * 1000;
      const chaveIp = `login-falha:${ip}`;
      if (golpeExcedido(chaveIp, { janelaMs: JANELA_FALHAS, max: 20 })) {
        return json(res, 429, {
          error: 'Muitas tentativas de senha. Aguarde alguns minutos e tente de novo.',
        });
      }
      let usuario = 'sem-usuario';
      try {
        await garantirStaffSeed();
        const b = await body(req);
        usuario = String(b.usuario || b.login || b.user || '').trim().toLowerCase() || 'sem-usuario';
        const chaveUsuario = `login-falha:${ip}:${usuario}`;
        if (golpeExcedido(chaveUsuario, { janelaMs: JANELA_FALHAS, max: 8 })) {
          return json(res, 429, {
            error: 'Muitas tentativas para este usuário. Aguarde alguns minutos.',
          });
        }
        const staff = await autenticar(b.usuario || b.login || b.user, b.senha);
        const token = await criarSessao(staff.id);
        /* Entrou: zera as falhas daquele usuário (a memória do bloqueio é para
           senha errada seguida de senha errada, não para atrapalhar o turno). */
        limparGolpes(chaveUsuario);
        res.setHeader('Set-Cookie', cookieDeSessao(token));
        return json(res, 200, {
          ok: true,
          staff,
          home: homeDoPapel(staff.papel),
        });
      } catch (e) {
        if (e instanceof ErroAuth) {
          /* Só falha de credencial alimenta o contador; erro de rede/banco não. */
          if (e.status === 401 || e.status === 400) {
            registrarGolpe(chaveIp);
            registrarGolpe(`login-falha:${ip}:${usuario}`);
          }
          return json(res, e.status, { error: e.message });
        }
        throw e;
      }
    }
    if (p === '/api/logout' && req.method === 'POST') {
      await destruirSessao(parseCookies(req)[SESSION_COOKIE]);
      res.setHeader('Set-Cookie', cookieDeLogout());
      return json(res, 200, { ok: true });
    }
    if (p === '/api/me' && req.method === 'GET') {
      const staff = await getStaffDaRequisicao(req);
      if (!staff) return json(res, 401, { error: 'Não autenticado' });
      return json(res, 200, { staff, home: homeDoPapel(staff.papel) });
    }

    if (p === '/api/config/pix' && req.method === 'GET') {
      /* Normalização é a MESMA do front (db/pix-normaliza.js é fonte única).
         Havia uma cópia divergente aqui que reescrevia chave aleatória (EVP)
         como CPF/telefone — 1,18% das chaves saíam destruídas e o QR apontava
         para uma chave inexistente mesmo com PIX_CHAVE correta no provedor. */
      const chave = normalizarChavePix(process.env.PIX_CHAVE);
      const inspecao = inspecionarChavePix(process.env.PIX_CHAVE);
      if (!inspecao.ok) {
        console.warn(`[PIX] ${inspecao.motivo} (tipo detectado: ${inspecao.tipo})`);
      }
      let nome = String(process.env.PIX_NOME || 'LANCHONETE').trim().toUpperCase();
      nome = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      nome = nome.replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25) || 'LANCHONETE';
      let cidade = String(process.env.PIX_CIDADE || 'BRASIL').trim().toUpperCase();
      cidade = cidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      cidade = cidade.replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 15) || 'BRASIL';
      /* `chaveValida`/`tipoChave`/`aviso` são diagnósticos para o operador:
         permitem mostrar "PIX não configurado" na tela em vez de um QR que o
         banco recusa. Campos novos — clientes antigos continuam funcionando. */
      return json(res, 200, {
        chave,
        nome,
        cidade,
        chaveValida: inspecao.ok,
        tipoChave: inspecao.tipo,
        aviso: inspecao.ok ? null : inspecao.motivo,
      });
    }

    try {
      if (p.startsWith('/api/admin')) {
        await exigirAcesso(req, 'admin');
      } else if (p.startsWith('/api/caixa')) {
        await exigirAcesso(req, 'caixa');
      } else if (p.startsWith('/api/cozinha')) {
        await exigirAcesso(req, 'cozinha');
      } else if (p.startsWith('/api/bar')) {
        await exigirAcesso(req, 'bar');
      }
    } catch (e) {
      if (e instanceof ErroAuth) return json(res, e.status, { error: e.message });
      throw e;
    }

    if (p === '/api/cozinha/pedidos' && req.method === 'GET') {
      return json(res, 200, await getFilaCozinha());
    }
    if (p === '/api/bar/pedidos' && req.method === 'GET') {
      return json(res, 200, await getFilaBar());
    }

    /* Avanço de status por ITEM (telas de cozinha/bar) */
    if ((m = p.match(/^\/api\/(cozinha|bar)\/itens\/(\d+)\/status$/)) && req.method === 'PATCH') {
      try {
        const setor = m[1];
        const out = await setStatusItem(Number(m[2]), (await body(req)).status, setor);
        broadcast('update', {
          type: 'item_status',
          itemId: out.itemId,
          status: out.status,
          pedidoId: out.pedidoId,
          pedidoStatus: out.pedidoStatus,
          setor: out.setor,
        });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroPedido) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    /* Avanço de status do PEDIDO (React Cozinha/Bar/Admin) */
    if ((m = p.match(/^\/api\/pedidos\/(\d+)\/status$/)) && req.method === 'PATCH') {
      try {
        await exigirAcesso(req, 'cozinha'); // admin também passa (ACESSO.admin inclui cozinha)
      } catch (e) {
        // bar também pode — tenta bar se cozinha falhou com 403
        if (e instanceof ErroAuth && e.status === 403) {
          try {
            await exigirAcesso(req, 'bar');
          } catch (e2) {
            if (e2 instanceof ErroAuth) return json(res, e2.status, { error: e2.message });
            throw e2;
          }
        } else if (e instanceof ErroAuth) {
          return json(res, e.status, { error: e.message });
        } else {
          throw e;
        }
      }
      try {
        const payload = await body(req);
        const staff = await getStaffDaRequisicao(req);
        const papel = staff && staff.papel;
        // bar só mexe em itens do bar; cozinha só cozinha; admin mexe em tudo
        let setor = null;
        if (papel === 'bar') setor = 'bar';
        else if (papel === 'cozinha') setor = 'cozinha';
        // SPA manda setor explícito (admin na tela cozinha/bar)
        if (payload.setor === 'bar' || payload.setor === 'cozinha') {
          if (papel === 'admin' || papel === payload.setor) setor = payload.setor;
        }
        const out = await setStatusPedido(Number(m[1]), payload.status, setor);
        broadcast('update', {
          type: 'status_alterado',
          pedidoId: Number(m[1]),
          status: out.status,
        });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroPedido) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    if (p === '/api/caixa/sessoes' && req.method === 'GET') {
      return json(res, 200, await listSessoesAbertas());
    }
    if ((m = p.match(/^\/api\/caixa\/sessoes\/(\d+)\/pagamentos$/)) && req.method === 'POST') {
      try {
        const out = await registrarPagamento(Number(m[1]), await body(req));
        broadcast('update', { type: 'pagamento_parcial', sessaoId: Number(m[1]) });
        return json(res, 201, out);
      } catch (e) {
        if (e instanceof ErroCaixa) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/caixa\/sessoes\/(\d+)\/pix-avisos\/(\d+)\/confirmar$/)) && req.method === 'POST') {
      try {
        const out = await confirmarPixAviso(Number(m[1]), Number(m[2]));
        broadcast('update', {
          type: 'pix_confirmado',
          sessaoId: Number(m[1]),
          avisoId: Number(m[2]),
        });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroCaixa) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/caixa\/sessoes\/(\d+)\/fechar$/)) && req.method === 'POST') {
      try {
        const out = await fecharSessao(Number(m[1]), await body(req));
        broadcast('update', { type: 'sessao_fechada', sessaoId: Number(m[1]) });
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroCaixa) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    if (p === '/api/mesas' && req.method === 'GET') {
      try {
        await exigirAcesso(req, 'admin');
        const rows = await listMesas();
        return json(res, 200, rows.map((m) => ({
          id: m.id,
          numero: m.numero,
          token: m.token,
          status: m.status,
          sessaoAberta: m.sessaoAberta,
        })));
      } catch (e) {
        if (e instanceof ErroAuth) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if (p === '/api/admin/mesas' && req.method === 'GET') {
      return json(res, 200, await listMesas());
    }
    if (p === '/api/admin/garcons' && req.method === 'GET') {
      return json(res, 200, await listGarcons());
    }
    if (p === '/api/admin/garcons' && req.method === 'POST') {
      try {
        return json(res, 201, await criarGarcom(await body(req)));
      } catch (e) {
        if (e instanceof ErroGarcom) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/admin\/garcons\/(\d+)$/)) && req.method === 'PATCH') {
      try {
        const b = await body(req);
        return json(res, 200, await setGarcomAtivo(Number(m[1]), b.ativo !== false));
      } catch (e) {
        if (e instanceof ErroGarcom) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/admin\/garcons\/(\d+)$/)) && req.method === 'DELETE') {
      try {
        return json(res, 200, await removerGarcom(Number(m[1])));
      } catch (e) {
        if (e instanceof ErroGarcom) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if (p === '/api/admin/dashboard' && req.method === 'GET') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      return json(res, 200, await resumoDia({ from: q.get('from') || null, to: q.get('to') || null }));
    }
    if (p === '/api/admin/relatorio' && req.method === 'GET') {
      try {
        const q = new URL(req.url, 'http://localhost').searchParams;
        return json(res, 200, await relatorioVendas({ from: q.get('from'), to: q.get('to') }));
      } catch (e) {
        console.error('[api/admin/relatorio]', e && e.stack ? e.stack : e);
        const status = (e && e.status) || 500;
        return json(res, status, { error: (e && e.message) || 'Erro interno no relatório' });
      }
    }
    if (p === '/api/admin/historico/purge' && req.method === 'POST') {
      try {
        const b = await body(req);
        return json(res, 200, await purgeHistorico({
          before: b.before,
          confirm: b.confirm === true,
          dryRun: b.dryRun === true,
        }));
      } catch (e) {
        if (e instanceof ErroPurge || e.status) return json(res, e.status || 400, { error: e.message });
        throw e;
      }
    }
    if (p === '/api/admin/pedidos' && req.method === 'GET') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const ativos = q.get('ativos') === '1' || q.get('ativos') === 'true';
      return json(res, 200, await listPedidosRecentes({
        limit: Number(q.get('limit')) || (ativos ? 100 : 80),
        ativos,
        from: q.get('from') || null,
        to: q.get('to') || null,
      }));
    }
    if (p === '/api/admin/cardapio' && req.method === 'GET') {
      return json(res, 200, await getCardapioAdmin());
    }

    if (p === '/api/admin/upload-foto' && req.method === 'POST') {
      try {
        const b = await body(req, { maxBytes: Number(process.env.FOTO_MAX_BODY_BYTES || 8 * 1024 * 1024) });
        const out = await processarUploadFoto(b);
        return json(res, 201, out);
      } catch (e) {
        if (e instanceof ErroFoto || e.status) {
          return json(res, e.status || 400, { error: e.message });
        }
        throw e;
      }
    }
    if (p === '/api/admin/categorias' && req.method === 'POST') {
      try {
        const out = await criarCategoria(await body(req));
        invalidarCardapio();
        return json(res, 201, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/admin\/categorias\/(\d+)$/)) && req.method === 'PATCH') {
      try {
        const out = await atualizarCategoria(Number(m[1]), await body(req));
        invalidarCardapio();
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    if ((m = p.match(/^\/api\/admin\/categorias\/(\d+)$/)) && req.method === 'DELETE') {
      try {
        const out = await removerCategoria(Number(m[1]));
        invalidarCardapio();
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    if (p === '/api/admin/categorias/ordem' && req.method === 'PUT') {
      try {
        const b = await body(req);
        const out = await reordenarCategorias(b.ids || b.ordem || []);
        invalidarCardapio();
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if (p === '/api/admin/produtos/ordem' && req.method === 'PUT') {
      try {
        const b = await body(req);
        const out = await reordenarProdutos(b.categoriaId, b.ids || b.ordem || []);
        invalidarCardapio();
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if (p === '/api/admin/produtos' && req.method === 'POST') {
      try {
        const out = await criarProduto(await body(req, { maxBytes: Number(process.env.FOTO_MAX_BODY_BYTES || 8 * 1024 * 1024) }));
        invalidarCardapio();
        return json(res, 201, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/admin\/produtos\/(\d+)$/)) && req.method === 'PATCH') {
      try {
        const out = await atualizarProduto(
          Number(m[1]),
          await body(req, { maxBytes: Number(process.env.FOTO_MAX_BODY_BYTES || 8 * 1024 * 1024) })
        );
        invalidarCardapio();
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    if ((m = p.match(/^\/api\/admin\/produtos\/(\d+)$/)) && req.method === 'DELETE') {
      try {
        const out = await removerProduto(Number(m[1]));
        invalidarCardapio();
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/admin\/produtos\/(\d+)\/adicionais$/)) && req.method === 'POST') {
      try {
        const out = await criarAdicional(Number(m[1]), await body(req));
        invalidarCardapio();
        return json(res, 201, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/admin\/adicionais\/(\d+)$/)) && req.method === 'DELETE') {
      try {
        const out = await removerAdicional(Number(m[1]));
        invalidarCardapio();
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/admin\/produtos\/(\d+)\/removiveis$/)) && req.method === 'PUT') {
      try {
        const b = await body(req);
        const out = await setRemoviveis(Number(m[1]), b.ingredientes || b.removiveis || []);
        invalidarCardapio();
        return json(res, 200, out);
      } catch (e) {
        if (e instanceof ErroAdmin) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    /* ---- UI: SPA React em dist/ (build obrigatório) ---- */
    const spaIndexPath = path.join(ROOT, 'dist', 'index.html');
    const hasSpa = fs.existsSync(spaIndexPath);

    const hashHome = (papel) => {
      if (papel === 'cozinha') return '/#/cozinha';
      if (papel === 'caixa') return '/#/caixa';
      if (papel === 'bar') return '/#/bar';
      return '/#/admin';
    };

    /* caminhos sem hash (QR impressos antigos) → redireciona para o router do React */
    if (hasSpa) {
      if (p === '/login') {
        res.writeHead(302, { Location: '/#/login' });
        return res.end();
      }
      if (p === '/cozinha') {
        res.writeHead(302, { Location: '/#/cozinha' });
        return res.end();
      }
      if (p === '/bar') {
        res.writeHead(302, { Location: '/#/bar' });
        return res.end();
      }
      if (p === '/caixa') {
        res.writeHead(302, { Location: '/#/caixa' });
        return res.end();
      }
      if (p === '/admin') {
        res.writeHead(302, { Location: '/#/admin' });
        return res.end();
      }
      if (p.startsWith('/mesa/')) {
        const token = p.slice('/mesa/'.length).split('/')[0];
        res.writeHead(302, { Location: '/#/mesa/' + encodeURIComponent(token) });
        return res.end();
      }
      if (p === '/garcom' || /^\/garcom\/[0-9a-f-]{36}$/i.test(p)) {
        const token = p.startsWith('/garcom/') ? p.slice('/garcom/'.length) : '';
        res.writeHead(302, { Location: token ? '/#/garcom/' + encodeURIComponent(token) : '/#/' });
        return res.end();
      }
      /* bookmarks/QR impressos antigos que apontavam para .html continuam
         funcionando: redireciona para a rota equivalente do React. */
      const legacyParaSpa = {
        '/admin.html': '/#/admin',
        '/cozinha.html': '/#/cozinha',
        '/bar.html': '/#/bar',
        '/caixa.html': '/#/caixa',
        '/login.html': '/#/login',
        '/garcom.html': '/#/',
        '/mesa.html': '/#/',
        '/pedido.html': '/#/',
        '/index.html': '/',
      };
      if (legacyParaSpa[p]) {
        res.writeHead(302, { Location: legacyParaSpa[p] });
        return res.end();
      }
      /* GET / sempre serve o index — o hash (#/admin) NÃO vai ao servidor.
         Redirecionar / → /#/admin causaria loop infinito. */
      if (p === '/') {
        try {
          const data = await fs.promises.readFile(spaIndexPath);
          return send(res, 200, 'text/html; charset=utf-8', data);
        } catch {
          /* fall through to legacy */
        }
      }
    }

    /* Sem dist/ não existe UI: em vez de servir um app antigo (e desatualizado)
       o servidor explica o que fazer. `npm run build` gera dist/index.html. */
    if (!hasSpa && !path.extname(p) && !p.startsWith('/api')) {
      return send(
        res,
        503,
        'text/html; charset=utf-8',
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pier 509 — build ausente</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#060f1d;color:#f0f6fd;
       font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;padding:24px}
  h1{font-size:1.5rem;margin:0 0 8px;color:#d9a63f}
  code{background:#10233a;border:1px solid #35516f;border-radius:8px;padding:4px 10px;display:inline-block;margin-top:8px}
  p{color:#bdcadc;line-height:1.5;max-width:44ch}
</style>
<h1>Pier 509 — interface não compilada</h1>
<p>Este servidor está de pé, mas a pasta <b>dist/</b> não existe. Rode o build e recarregue:</p>
<code>npm run build</code>
</body></html>`
      );
    }

    /* assets da SPA (se build multi-file no futuro) */
    if (hasSpa && (p.startsWith('/assets/') || p === '/index.html')) {
      const distRoot = path.resolve(ROOT, 'dist');
      const fp = path.resolve(distRoot, '.' + (p === '/index.html' ? '/index.html' : p));
      if (fp.startsWith(distRoot + path.sep) || fp === path.join(distRoot, 'index.html')) {
        try {
          const data = await fs.promises.readFile(fp);
          return send(res, 200, mime[path.extname(fp)] || 'application/octet-stream', data, {
            'Cache-Control': cachePara(fp),
          });
        } catch (_) {}
      }
    }

    /* GET / com SPA já tratado; qualquer path sem extensão → index SPA (deep link) */
    if (hasSpa && !path.extname(p) && !p.startsWith('/api')) {
      try {
        const data = await fs.promises.readFile(spaIndexPath);
        return send(res, 200, 'text/html; charset=utf-8', data);
      } catch (_) {}
    }

    const file = p;
    const publicRoot = path.resolve(ROOT, 'public');
    const fp = path.resolve(publicRoot, '.' + (file.startsWith('/') ? file : '/' + file));
    if (!fp.startsWith(publicRoot + path.sep) && fp !== publicRoot) {
      return send(res, 400, 'text/plain', 'Bad path');
    }
    try {
      const data = await fs.promises.readFile(fp);
      return send(res, 200, mime[path.extname(fp)] || 'application/octet-stream', data, {
        'Cache-Control': cachePara(fp),
      });
    } catch {
      return send(res, 404, 'text/plain', '404');
    }
  } catch (e) {
    /* 4xx é erro do cliente (JSON malformado, corpo grande demais, validação):
       não merece stack trace no log — em produção isso polui o log do provedor
       e dispara alerta de erro para algo que é comportamento esperado.
       ATENÇÃO: `p` (u.pathname) é declarado DENTRO do try; aqui só existe
       req.url, e usá-lo sem esse cuidado derruba o processo. */
    if (e && e.status && e.status >= 400 && e.status < 500) {
      console.warn(`[http ${e.status}] ${req.method} ${req.url} — ${e.message || 'rejeitado'}`);
      return json(res, e.status, { error: e.message || 'Erro' });
    }
    console.error(e);
    if (e && e.status) {
      return json(res, e.status, { error: e.message || 'Erro' });
    }
    /* Violação de integridade do Postgres (FK, unique, check) não é erro
       interno: é entrada inválida. Responder 500 vazava nome de constraint e
       virava alerta falso no monitoramento. */
    if (e && typeof e.code === 'string' && e.code.startsWith('23')) {
      const amigavel =
        e.code === '23505'
          ? 'Registro duplicado: já existe um item com esses dados.'
          : 'Os dados enviados não fecham com o cadastro atual (verifique categoria, produto e valores).';
      console.warn(`[http 409] ${req.method} ${req.url} — integridade ${e.code} (${e.constraint || 'sem constraint'})`);
      return json(res, 409, { error: amigavel });
    }
    const msg =
      process.env.NODE_ENV === 'production'
        ? 'Erro interno do servidor'
        : (e && e.message) || 'Erro interno';
    json(res, 500, { error: msg });
  }
});

/* Porta ocupada é erro de operação, não bug: explique e saia limpo em vez de
   derrubar o processo com um 'Unhandled error event'. */
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`❌ A porta ${PORT} já está em uso — feche o outro processo ou mude PORT no .env.`);
  } else {
    console.error('❌ Não foi possível subir o servidor:', (e && e.message) || e);
  }
  process.exit(1);
});

server.listen(PORT, async () => {
  console.log(`⚓ Pier 509 — comanda digital: http://localhost:${PORT}`);
  /* Encerramento gracioso: o provedor envia SIGTERM antes de matar o processo.
     Sem isso, requisições e o pool ficam pendurados e o deploy dá 502. */
  const encerrar = async (sinal) => {
    console.log(`\n${sinal} recebido — fechando Pier 509 com calma…`);
    server.close(() => {});
    try {
      const { clientCount } = require('./db/events');
      if (clientCount()) console.log(`fechando ${clientCount()} conexão(ões) ao vivo`);
    } catch (_) {}
    const prazo = setTimeout(() => process.exit(0), 8000);
    prazo.unref();
    try {
      await pool.end();
    } catch (_) {}
    console.log('pool encerrado · tchau!');
    process.exit(0);
  };
  process.once('SIGTERM', () => void encerrar('SIGTERM'));
  process.once('SIGINT', () => void encerrar('SIGINT'));
  // Auto-migrate best-effort: aplica migrations pendentes na inicialização
  // (idempotente — já aplicadas são puladas). Nunca derruba o servidor.
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [require('path').join(__dirname, 'db', 'migrate.js')], {
      encoding: 'utf8',
      timeout: 30000,
    });
    if (r.status === 0) {
      console.log('🧬 Migrations verificadas/aplicadas na inicialização.');
    } else {
      console.warn('⚠️ Auto-migrate pulado:', String(r.stderr || r.stdout || '').slice(0, 200));
    }
  } catch (e) {
    console.warn('⚠️ Auto-migrate indisponível:', (e && e.message) || e);
  }
  try {
    const seed = await garantirStaffSeed();
    if (seed.created) {
      console.log('Staff inicial criado (admin / cozinha / caixa). Troque as senhas em produção.');
    }
  } catch (e) {
    console.error('Aviso: não foi possível garantir seed de staff:', e.message || e);
  }
});

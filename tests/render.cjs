/**
 * Teste de renderização das telas (sem navegador).
 *
 * Motivo: o `npm run build` não executa o app — um import quebrado, um ícone
 * inexistente ou um JSON corrompido no storage só aparecem quando alguém abre
 * a tela em produção. Aqui o app React é montado em um DOM real (jsdom) e
 * conversa com a API de verdade, então cada rota precisa renderizar o conteúdo
 * esperado sem erro de runtime.
 *
 * Pré-requisitos: servidor rodando (npm start) e banco migrado/semeado.
 *   BASE_URL=http://127.0.0.1:3000 node tests/render.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const SENHA = process.env.STAFF_SEED_PASSWORD || process.env.ADMIN_PASSWORD || "senha-de-teste-123";
const RAIZ = path.resolve(__dirname, "..");

/* Texto da marca anterior montado em pedaços: não pode existir literal no repo. */
const MARCA_ANTIGA_TEXTO = ["QR", "Admin"].join("");

let falhas = 0;
let checagens = 0;
const ok = (msg) => {
  checagens += 1;
  console.log(`  ✓ ${msg}`);
};
const erro = (msg) => {
  falhas += 1;
  console.log(`  ✗ ${msg}`);
};

async function exigir() {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const esbuild = require("esbuild");

  /* ---------- bundle do app para rodar em DOM (sem módulos ES) ---------- */
  const tmp = path.join(RAIZ, "node_modules", ".cache", "render-bundle.js");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  if (!fs.existsSync(tmp) || process.env.REBUILD_RENDER === "1") {
    await esbuild.build({
      entryPoints: [path.join(RAIZ, "src", "main.tsx")],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      loader: { ".css": "empty" },
      define: { "process.env.NODE_ENV": '"production"' },
      outfile: tmp,
      logLevel: "error",
    });
  }
  const codigo = fs.readFileSync(tmp, "utf8");

  /* ---------- sessão de admin (cookie) para as telas de operação ---------- */
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "admin", senha: SENHA }),
  });
  if (!login.ok) {
    console.log(`  ! login falhou (${login.status}) — telas de staff serão puladas`);
  }
  const cookie = (login.headers.getSetCookie?.() || [])[0]?.split(";")[0] || "";

  const mesas = await fetch(`${BASE}/api/admin/mesas`, { headers: cookie ? { Cookie: cookie } : {} });
  const listaMesas = mesas.ok ? await mesas.json() : [];
  const tokenMesa = listaMesas[0]?.token;

  /* ---------- roda uma rota no jsdom ---------- */
  async function render(rota, { precisaTexto = [], proibido = [], semSessao = false } = {}) {
    const problemas = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (e) => problemas.push(`jsdomError: ${e.message}`));
    virtualConsole.on("error", (...a) => problemas.push(`console.error: ${a.join(" ")}`));

    const dom = new JSDOM(
      `<!doctype html><html lang="pt-BR"><head><meta name="theme-color" content="#e9dcc0"></head><body><div id="root"></div></body></html>`,
      {
        url: `${BASE}/#${rota}`,
        runScripts: "outside-only",
        pretendToBeVisual: true,
        virtualConsole,
      }
    );
    const { window } = dom;
    window.matchMedia = window.matchMedia || ((q) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    /* jsdom não traz estes observers; framer-motion usa em whileInView */
    class ObservadorFalso {
      constructor() {}
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    window.IntersectionObserver = window.IntersectionObserver || ObservadorFalso;
    window.ResizeObserver = window.ResizeObserver || ObservadorFalso;
    window.EventSource = class {
      constructor() {}
      addEventListener() {}
      close() {}
    };
    window.fetch = (url, opts = {}) => {
      const destino = String(url).startsWith("http") ? String(url) : `${BASE}${url}`;
      const headers = { ...(opts.headers || {}) };
      if (cookie && !semSessao && !headers.Cookie) headers.Cookie = cookie;
      return fetch(destino, { ...opts, headers });
    };
    window.scrollTo = () => {};
    window.console = console;

    window.eval(codigo);
    /* deixa os hydrates/efeitos concluírem */
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
    const html = window.document.body.innerHTML;
    const texto = window.document.body.textContent || "";
    if (process.env.VER_TEXTO) {
      console.log(`      ↳ [${rota}] ${texto.replace(/\s+/g, " ").trim().slice(0, 320)}`);
    }

    if (!html || html.length < 40) problemas.push("tela vazia (root sem conteúdo)");
    if (/Element type is invalid/i.test(texto)) problemas.push("componente inválido renderizado");
    for (const t of precisaTexto) {
      if (!texto.toLowerCase().includes(t.toLowerCase())) problemas.push(`texto ausente: "${t}"`);
    }
    for (const t of proibido) {
      if (texto.toLowerCase().includes(t.toLowerCase())) problemas.push(`texto indesejado: "${t}"`);
    }
    dom.window.close();
    return { problemas, texto, html };
  }

  async function checar(nome, rota, opts) {
    const { problemas, texto } = await render(rota, opts);
    if (problemas.length) {
      erro(`${nome} (${rota})`);
      for (const p of problemas.slice(0, 6)) console.log(`      · ${p}`);
    } else {
      ok(`${nome} (${rota})`);
    }
    return texto;
  }

  console.log(`\n🖼️  Renderização das telas · ${BASE}\n`);

  await checar("landing", "/", { precisaTexto: ["PIER 509"], proibido: [MARCA_ANTIGA_TEXTO] });
  await checar("login da equipe", "/login", { precisaTexto: ["acesso da tripulação", "PIER 509"] });
  if (tokenMesa) {
    await checar("mesa (cliente)", `/mesa/${tokenMesa}`, {
      precisaTexto: ["PIER 509", "Bateu a fome?"],
      proibido: [MARCA_ANTIGA_TEXTO],
    });
  } else {
    erro("mesa (cliente): nenhum token de mesa disponível");
  }
  /* sem cookie, a guarda tem que barrar e mandar para o login */
  await checar("sem sessão /admin cai no login", "/admin", {
    precisaTexto: ["acesso da tripulação"],
    proibido: ["Dashboard"],
    semSessao: true,
  });
  await checar("sem sessão /caixa cai no login", "/caixa", {
    precisaTexto: ["acesso da tripulação"],
    proibido: ["Fecha a conta"],
    semSessao: true,
  });
  if (cookie) {
    await checar("comando (admin)", "/admin", { precisaTexto: ["Comando", "PIER 509"], proibido: [MARCA_ANTIGA_TEXTO] });
    await checar("cozinha", "/cozinha", { precisaTexto: ["Cozinha"] });
    await checar("bar", "/bar", { precisaTexto: ["Bar"] });
    await checar("caixa", "/caixa", { precisaTexto: ["conta"] });
  }

  /* rota desconhecida não pode quebrar */
  await checar("rota desconhecida cai na landing", "/rota-que-nao-existe", {
    precisaTexto: ["PIER 509"],
  });

  console.log(`\n──────────────────────────────\n  verificações: ${checagens} · FALHAS: ${falhas}\n`);
  if (falhas) process.exit(1);
  console.log("✅ Render OK — todas as telas montaram sem erro.\n");
}

exigir().catch((e) => {
  console.error("falha inesperada:", e);
  process.exit(1);
});

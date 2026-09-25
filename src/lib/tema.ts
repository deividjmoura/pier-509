/* Tema claro/escuro — valores canônicos em PT: "claro" | "escuro".
   Compat: aceita (e normaliza) os legados "light"/"dark".

   Três camadas de defesa para a troca funcionar sempre:
   1. atributo data-theme (canônico) + classe .dark (CSS legado);
   2. fallback inline das variáveis críticas (CSS antigo em cache);
   3. CSS aceita "escuro" E "dark" (src/index.css). */
export type Tema = "claro" | "escuro";

const KEY = "pier509-tema";
export const EVENTO_TEMA = "pier509-tema";

/** Variáveis críticas aplicadas inline — sobrevivem a CSS antigo/cacheado no deploy. */
const VARS_CLARO: Record<string, string> = {
  "--p509-page": "#e9dcc0",
  "--p509-text": "#2b2113",
  "--p509-white": "#f8f1de",
  "--p509-slate-50": "#efe3c9",
  "--p509-slate-100": "#e8d9b9",
  "--p509-slate-200": "#d8c49c",
  "--p509-slate-300": "#c2a877",
  "--p509-slate-400": "#9a8358",
  "--p509-slate-500": "#7a6540",
  "--p509-slate-600": "#61502f",
  "--p509-slate-700": "#4a3b21",
  "--p509-slate-800": "#322716",
  "--p509-navy-500": "#3d6076",
  "--p509-navy-700": "#26485f",
  "--p509-navy-800": "#17334a",
  "--p509-navy-900": "#2b2113",
  "--p509-brand-50": "#f7ecd0",
  "--p509-brand-400": "#c6952f",
  "--p509-brand-500": "#a9791f",
  "--p509-brand-600": "#8c6318",
  "--p509-brand-700": "#6d4c12",
  "--p509-teal-400": "#2fae8c",
  "--p509-teal-500": "#1f8a6d",
  "--p509-teal-600": "#146b55",
  "--p509-teal-700": "#0f5443",
  "--p509-grad-from": "#6d4c12",
  "--p509-grad-to": "#146b55",
  "--p509-stroke": "rgba(43, 33, 19, 0.34)",
  "--p509-card-shadow": "0 1px 2px rgba(60, 45, 20, 0.08), 0 14px 30px -20px rgba(60, 45, 20, 0.35)",
  "--p509-card-shadow-deep": "0 2px 4px rgba(60, 45, 20, 0.1), 0 24px 50px -24px rgba(60, 45, 20, 0.45)",
  "--p509-scrollbar": "#c2a877",
  "--p509-corda": "#a9791f",
  "--p509-vidro": "rgba(248, 241, 222, 0.86)",
  "--p509-marinho": "233, 220, 192",
};

const VARS_ESCURO: Record<string, string> = {
  "--p509-page": "#060f1d",
  "--p509-text": "#f0f6fd",
  "--p509-white": "#10233a",
  "--p509-slate-50": "#081726",
  "--p509-slate-100": "#14283f",
  "--p509-slate-200": "#223a55",
  "--p509-slate-300": "#35516f",
  "--p509-slate-400": "#7d94ad",
  "--p509-slate-500": "#a0b4c9",
  "--p509-slate-600": "#bdcadc",
  "--p509-slate-700": "#d4dfeb",
  "--p509-slate-800": "#e9f1fa",
  "--p509-navy-500": "#7fa6cd",
  "--p509-navy-700": "#aecdee",
  "--p509-navy-800": "#cbe0f5",
  "--p509-navy-900": "#f0f6fd",
  "--p509-brand-50": "#2a1f08",
  "--p509-brand-400": "#f0d089",
  "--p509-brand-500": "#d9a63f",
  "--p509-brand-600": "#e9bd62",
  "--p509-brand-700": "#f5dda3",
  "--p509-teal-400": "#4fd0a8",
  "--p509-teal-500": "#2fae8c",
  "--p509-teal-600": "#4fd0a8",
  "--p509-teal-700": "#86e3c6",
  "--p509-grad-from": "#f5dda3",
  "--p509-grad-to": "#4fd0a8",
  "--p509-stroke": "rgba(240, 246, 253, 0.34)",
  "--p509-card-shadow": "0 1px 2px rgba(0, 0, 0, 0.45), 0 14px 34px -20px rgba(0, 0, 0, 0.75)",
  "--p509-card-shadow-deep": "0 2px 5px rgba(0, 0, 0, 0.5), 0 26px 54px -24px rgba(0, 0, 0, 0.8)",
  "--p509-scrollbar": "#33506f",
  "--p509-corda": "#b98a34",
  "--p509-vidro": "rgba(16, 35, 58, 0.82)",
  "--p509-marinho": "6, 15, 29",
};

/** Cor da barra do navegador em cada tema (meta theme-color). */
export const COR_BARRA: Record<Tema, string> = {
  claro: "#e9dcc0",
  escuro: "#060f1d",
};

function aplicarVarsInline(t: Tema) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = t === "escuro" ? VARS_ESCURO : VARS_CLARO;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
}

/** Normaliza qualquer valor já visto em produção para o par canônico PT. */
function normalizar(valor: string | null | undefined): Tema | null {
  if (valor === "escuro" || valor === "dark") return "escuro";
  if (valor === "claro" || valor === "light") return "claro";
  return null;
}

function lerSalvo(): Tema | null {
  try {
    const atual = normalizar(localStorage.getItem(KEY));
    if (atual) return atual;
  } catch {
    /* Armazenamento pode estar bloqueado; o tema continua funcionando. */
  }
  return null;
}

export function temaAtual(): Tema {
  if (typeof window === "undefined") return "claro";
  const doAtributo = normalizar(document.documentElement.getAttribute("data-theme"));
  if (doAtributo) return doAtributo;
  const salvo = lerSalvo();
  if (salvo) return salvo;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "escuro" : "claro";
}

export function aplicarTema(t: Tema) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // 1) Atributo canônico — o CSS novo casa com [data-theme="escuro"/"claro"].
  root.setAttribute("data-theme", t);
  // 2) Classe .dark — compatível com CSS legado que case por classe.
  root.classList.toggle("dark", t === "escuro");
  root.classList.toggle("tema-escuro", t === "escuro");
  root.classList.toggle("tema-claro", t === "claro");
  // 3) Fallback inline — garante troca visual mesmo se o CSS do deploy estiver em cache antigo.
  aplicarVarsInline(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* modo anônimo etc. */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", COR_BARRA[t]);
  window.dispatchEvent(new CustomEvent<Tema>(EVENTO_TEMA, { detail: t }));
}

export function alternarTema() {
  aplicarTema(temaAtual() === "claro" ? "escuro" : "claro");
}

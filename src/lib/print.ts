/** Cupons / comandas de impressão (térmica 58–80mm) + relatório de vendas. */

import type { ItemPedido, Pedido } from "./types";
import { BRL } from "./utils";
import { MARCA } from "./marca";

export type SetorComanda = "cozinha" | "bar" | "garcom" | "geral";

const FORMA_LABEL: Record<string, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  credito: "Cartão crédito",
  debíto: "Cartão débito",
  debito: "Cartão débito",
  cartao_credito: "Cartão crédito",
  cartao_debito: "Cartão débito",
  credito_credito: "Cartão crédito",
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formaLabel(raw: unknown): string {
  const k = String(raw || "").trim().toLowerCase();
  if (!k) return "—";
  return FORMA_LABEL[k] || String(raw);
}

function fmtHora(ts: number | string | Date | undefined | null): string {
  try {
    const d = ts instanceof Date ? ts : new Date(ts || Date.now());
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtHoraCurta(ts: number | string | Date | undefined | null): string {
  try {
    const d = ts instanceof Date ? ts : new Date(ts || Date.now());
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/** CSS base cupom térmico (58mm ≈ 220px @ 96dpi; usa 72mm útil). */
const CSS_CUPOM = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 8px 10px 16px;
    color: #000;
    background: #fff;
    font-family: ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace;
    font-size: 12px;
    line-height: 1.35;
    width: 72mm;
    max-width: 100%;
  }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .title {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0 0 2px;
  }
  .sub {
    font-size: 11px;
    margin: 0 0 6px;
  }
  .mesa {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.04em;
    margin: 4px 0 2px;
  }
  .line {
    border: none;
    border-top: 1px dashed #000;
    margin: 8px 0;
  }
  .line-solid {
    border: none;
    border-top: 2px solid #000;
    margin: 8px 0;
  }
  .meta { font-size: 11px; }
  .meta b { font-weight: 700; }
  .item {
    margin: 6px 0;
    page-break-inside: avoid;
  }
  .item-head {
    font-size: 13px;
    font-weight: 700;
  }
  .item-extra {
    font-size: 11px;
    padding-left: 14px;
    margin-top: 1px;
  }
  .foot {
    font-size: 10px;
    text-align: center;
    margin-top: 10px;
  }
  @media print {
    body { padding: 0; width: 72mm; }
    @page { margin: 4mm; size: auto; }
  }
`;

/**
 * Impressão via iframe same-origin + document.write.
 * Blob URL é bloqueado pelo CSP (frame-src default-src 'self') — não usar blob em iframe.
 */
function openPrintWindow(title: string, bodyHtml: string, autoPrint = true) {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <style>${CSS_CUPOM}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  const printFromIframe = (): boolean => {
    try {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("title", title);
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        iframe.remove();
        return false;
      }

      doc.open();
      doc.write(html);
      doc.close();

      const win = iframe.contentWindow;
      if (!win) {
        iframe.remove();
        return false;
      }

      const cleanup = () => {
        setTimeout(() => {
          try {
            iframe.remove();
          } catch (_) {}
        }, 1500);
      };

      if (autoPrint) {
        setTimeout(() => {
          try {
            win.focus();
            win.print();
          } catch (e) {
            console.warn("[print]", e);
          }
          cleanup();
        }, 250);
      } else {
        cleanup();
      }
      return true;
    } catch (e) {
      console.warn("[print iframe]", e);
      return false;
    }
  };

  if (printFromIframe()) return;

  /* Fallback: nova aba same-origin com document.write (sem noopener) */
  const w = window.open("about:blank", "_blank", "width=420,height=720");
  if (!w) {
    alert("Permita pop-ups para imprimir o cupom");
    return;
  }
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
    if (autoPrint) {
      setTimeout(() => {
        try {
          w.focus();
          w.print();
        } catch (_) {}
      }, 300);
    }
  } catch (e) {
    console.warn("[print window]", e);
    alert("Não foi possível preparar a impressão. Tente novamente.");
  }
}

function extrasLinhas(it: ItemPedido): string[] {
  const lines: string[] = [];
  if (it.escolha?.nome) lines.push(`→ ${it.escolha.nome}`);
  for (const a of it.adicionais || []) {
    if (a?.nome) lines.push(`+ ${a.nome}`);
  }
  for (const r of it.removidos || []) {
    if (r) lines.push(`sem ${r}`);
  }
  if (it.obs) lines.push(`Obs: ${it.obs}`);
  return lines;
}

function renderItensProducao(itens: ItemPedido[]): string {
  if (!itens.length) {
    return `<div class="meta center">— sem itens —</div>`;
  }
  return itens
    .map((it) => {
      const extras = extrasLinhas(it)
        .map((e) => `<div class="item-extra">${esc(e)}</div>`)
        .join("");
      return `<div class="item">
        <div class="item-head">${esc(String(it.qtd))}x ${esc(it.nome)}</div>
        ${extras}
      </div>`;
    })
    .join("");
}

function filtrarItens(
  pedido: Pedido,
  setor?: SetorComanda,
  soProntos?: boolean
): ItemPedido[] {
  let itens = [...(pedido.itens || [])];
  if (setor === "cozinha" || setor === "bar") {
    itens = itens.filter((i) => (i.setor || "cozinha") === setor);
  }
  if (soProntos) {
    itens = itens.filter((i) => i.status === "concluido" || i.status === "entregue");
  }
  /* produção: não lista o que já foi entregue */
  if (setor === "cozinha" || setor === "bar") {
    itens = itens.filter((i) => i.status !== "entregue");
  }
  return itens;
}

const TITULO_SETOR: Record<SetorComanda, string> = {
  cozinha: "COMANDA COZINHA",
  bar: "COMANDA BAR",
  garcom: "ENTREGA · GARÇOM",
  geral: "COMANDA",
};

/**
 * Cupom de produção / entrega.
 * - cozinha / bar: só mesa, pedido, cliente, hora e itens (sem preço)
 * - garcom: itens prontos para levar
 */
function renderItensComPreco(itens: ItemPedido[]): string {
  if (!itens.length) {
    return `<div class="meta center">— sem itens —</div>`;
  }
  return itens
    .map((it) => {
      const unit = Number(it.totalUnit ?? it.precoBase ?? 0);
      const line = unit * (Number(it.qtd) || 1);
      const extras = extrasLinhas(it)
        .map((e) => `<div class="item-extra">${esc(e)}</div>`)
        .join("");
      return `<div class="item">
        <div class="item-head" style="display:flex;justify-content:space-between;gap:8px">
          <span>${esc(String(it.qtd))}x ${esc(it.nome)}</span>
          <span>${esc(BRL(line))}</span>
        </div>
        ${extras}
      </div>`;
    })
    .join("");
}

export function imprimirComanda(
  pedido: Pedido,
  opts?: {
    setor?: SetorComanda;
    soProntos?: boolean;
    /** histórico / admin: mostra preços e total */
    comPrecos?: boolean;
    formaPagamento?: string | null;
    tituloExtra?: string;
  }
) {
  const setor: SetorComanda = opts?.setor || "geral";
  const soProntos = opts?.soProntos ?? setor === "garcom";
  const comPrecos = !!opts?.comPrecos;
  const itens = filtrarItens(pedido, setor, soProntos);
  const titulo = opts?.tituloExtra || TITULO_SETOR[setor];
  const mesaNum = String(pedido.mesaNome || "")
    .replace(/^Mesa\s*/i, "")
    .trim() || "—";

  const total =
    Number(pedido.total) ||
    itens.reduce((a, i) => a + Number(i.totalUnit || i.precoBase || 0) * (Number(i.qtd) || 1), 0);

  const forma = opts?.formaPagamento ? formaLabel(opts.formaPagamento) : "";

  const body = `
  <div class="center">
    <p class="title">${esc(titulo)}</p>
    <p class="sub">${MARCA.assinatura}</p>
  </div>
  <hr class="line-solid"/>
  <div class="center">
    <div class="mesa">MESA ${esc(mesaNum)}</div>
    <div class="meta bold">Pedido #${esc(pedido.id)}</div>
  </div>
  <div class="meta" style="margin-top:6px">
    ${pedido.clienteNome ? `<div><b>Cliente:</b> ${esc(pedido.clienteNome)}</div>` : ""}
    <div><b>Hora:</b> ${esc(fmtHora(pedido.criadoEm))}</div>
    ${pedido.status ? `<div><b>Status:</b> ${esc(String(pedido.status))}</div>` : ""}
    ${
      setor === "garcom"
        ? `<div><b>Itens:</b> ${itens.reduce((a, i) => a + (Number(i.qtd) || 1), 0)}</div>`
        : ""
    }
  </div>
  <hr class="line"/>
  ${comPrecos ? renderItensComPreco(itens) : renderItensProducao(itens)}
  <hr class="line"/>
  ${
    comPrecos
      ? `<div class="meta" style="display:flex;justify-content:space-between;font-size:14px;font-weight:800;margin:6px 0">
          <span>TOTAL</span><span>${esc(BRL(total))}</span>
        </div>
        ${forma ? `<div class="meta"><b>Pagamento:</b> ${esc(forma)}</div>` : ""}
        <hr class="line"/>`
      : ""
  }
  <div class="foot">
    ${fmtHoraCurta(Date.now())} · ${esc(titulo)}
  </div>
  `;

  openPrintWindow(`${titulo} #${pedido.id}`, body, true);
}

/** Cupom completo do histórico (itens + preços + total + forma se houver). */
export function imprimirComandaHistorico(
  pedido: Pedido,
  opts?: { formaPagamento?: string | null }
) {
  imprimirComanda(pedido, {
    setor: "geral",
    comPrecos: true,
    tituloExtra: "PEDIDO",
    formaPagamento: opts?.formaPagamento,
  });
}

/** Alias explícito por tela */
export function imprimirComandaCozinha(pedido: Pedido) {
  imprimirComanda(pedido, { setor: "cozinha" });
}
export function imprimirComandaBar(pedido: Pedido) {
  imprimirComanda(pedido, { setor: "bar" });
}
export function imprimirComandaGarcom(pedido: Pedido) {
  imprimirComanda(pedido, { setor: "garcom", soProntos: true });
}

/**
 * Relatório de vendas (A4) — faturamento, formas de pagamento e contas fechadas.
 */
export function imprimirRelatorioPdf(opts: {
  from: string;
  to: string;
  resumo: Record<string, unknown>;
  contas: any[];
  porDia?: any[];
  topProdutos?: any[];
}) {
  const { from, to, resumo, contas, porDia = [], topProdutos = [] } = opts;
  const fat = Number(resumo.faturamento ?? 0);
  const qtd = Number(resumo.contasFechadas ?? contas.length);
  const ticket = Number(resumo.ticketMedio ?? (qtd ? fat / qtd : 0));

  const porFormaRaw =
    (resumo.porFormaPagamento as Record<string, number> | undefined) ||
    (resumo.por_forma as Record<string, number> | undefined) ||
    {};

  /* agrega formas a partir das contas se o resumo vier vazio */
  const porForma: Record<string, number> = { ...porFormaRaw };
  if (!Object.keys(porForma).length) {
    for (const c of contas) {
      const forma = String(c.forma || c.formaPagamento || c.forma_pagamento || "outros");
      const val = Number(c.valorCobrado ?? c.valor ?? 0);
      porForma[forma] = (porForma[forma] || 0) + val;
    }
  }

  const formasRows = Object.entries(porForma)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(
      ([k, v]) =>
        `<tr>
          <td>${esc(formaLabel(k))}</td>
          <td class="num">${esc(BRL(Number(v || 0)))}</td>
          <td class="num">${fat > 0 ? ((Number(v || 0) / fat) * 100).toFixed(1) + "%" : "—"}</td>
        </tr>`
    )
    .join("");

  const contasRows = contas
    .map((c) => {
      const forma = formaLabel(c.forma ?? c.formaPagamento ?? c.forma_pagamento);
      const valor = Number(c.valorCobrado ?? c.valor ?? 0);
      const desconto = Number(c.desconto ?? 0);
      const taxa = Number(c.taxaServico ?? c.taxa ?? 0);
      const fechada =
        c.fechadaEm || c.fechada_em
          ? String(c.fechadaEm || c.fechada_em).slice(0, 16).replace("T", " ")
          : "—";
      return `<tr>
        <td>${esc(c.id)}</td>
        <td>${esc(c.mesa ?? "")}</td>
        <td>${esc(c.cliente || "—")}</td>
        <td class="num">${esc(BRL(valor))}</td>
        <td>${desconto ? esc(BRL(desconto)) : "—"}</td>
        <td>${taxa ? esc(BRL(taxa)) : "—"}</td>
        <td><b>${esc(forma)}</b></td>
        <td>${esc(fechada)}</td>
      </tr>`;
    })
    .join("");

  const diasRows = porDia
    .map(
      (d) =>
        `<tr>
          <td>${esc(d.dia)}</td>
          <td class="num">${esc(d.contas)}</td>
          <td class="num">${esc(BRL(Number(d.faturamento || 0)))}</td>
        </tr>`
    )
    .join("");

  const topRows = (topProdutos || [])
    .slice(0, 15)
    .map((p: any, i: number) => {
      const nome = p.nome || p.produto || "—";
      const q = p.qtd ?? p.quantidade ?? p.vendidos ?? "—";
      return `<tr><td>${i + 1}</td><td>${esc(nome)}</td><td class="num">${esc(q)}</td></tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Relatório ${esc(from)} — ${esc(to)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      padding: 24px;
      color: #111;
      max-width: 960px;
      margin: 0 auto;
      font-size: 13px;
    }
    h1 { font-size: 1.45rem; margin: 0 0 4px; }
    h2 {
      font-size: 0.95rem;
      margin: 22px 0 8px;
      padding-bottom: 4px;
      border-bottom: 2px solid #111;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .muted { color: #555; font-size: 0.85rem; }
    .kpis { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
    .kpi {
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 12px 16px;
      min-width: 140px;
    }
    .kpi span { display: block; font-size: 0.7rem; color: #666; text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi b { font-size: 1.2rem; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 0.88rem; }
    th, td { border-bottom: 1px solid #e2e2e2; padding: 7px 6px; text-align: left; vertical-align: top; }
    th { font-size: 0.68rem; text-transform: uppercase; color: #666; letter-spacing: 0.03em; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .btn {
      display: inline-block;
      padding: 10px 16px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 14px;
      border: 1px solid #111;
      background: #111;
      color: #fff;
      border-radius: 6px;
    }
    .foot { margin-top: 28px; font-size: 0.75rem; color: #777; text-align: center; }
    @media print {
      .btn { display: none; }
      body { padding: 0; }
      @page { margin: 12mm; }
    }
  </style>
</head>
<body>
  <button class="btn" type="button" onclick="window.print()">Imprimir / Salvar PDF</button>
  <h1>Relatório de vendas</h1>
  <p class="muted">
    Período: <b>${esc(from)}</b> → <b>${esc(to)}</b>
    · Gerado em ${esc(fmtHora(Date.now()))}
    · ${MARCA.nome}
  </p>

  <div class="kpis">
    <div class="kpi"><span>Faturamento</span><b>${esc(BRL(fat))}</b></div>
    <div class="kpi"><span>Contas fechadas</span><b>${esc(qtd)}</b></div>
    <div class="kpi"><span>Ticket médio</span><b>${esc(BRL(ticket))}</b></div>
  </div>

  <h2>Formas de pagamento</h2>
  ${
    formasRows
      ? `<table>
        <thead><tr><th>Forma</th><th class="num">Total</th><th class="num">%</th></tr></thead>
        <tbody>${formasRows}</tbody>
      </table>`
      : `<p class="muted">Sem dados de forma de pagamento neste período.</p>`
  }

  ${
    diasRows
      ? `<h2>Por dia</h2>
      <table>
        <thead><tr><th>Dia</th><th class="num">Contas</th><th class="num">Faturamento</th></tr></thead>
        <tbody>${diasRows}</tbody>
      </table>`
      : ""
  }

  ${
    topRows
      ? `<h2>Top produtos</h2>
      <table>
        <thead><tr><th>#</th><th>Produto</th><th class="num">Qtd</th></tr></thead>
        <tbody>${topRows}</tbody>
      </table>`
      : ""
  }

  <h2>Contas fechadas</h2>
  ${
    contasRows
      ? `<table>
        <thead>
          <tr>
            <th>#</th>
            <th>Mesa</th>
            <th>Cliente</th>
            <th class="num">Cobrado</th>
            <th class="num">Desc.</th>
            <th class="num">Taxa</th>
            <th>Forma de pagamento</th>
            <th>Fechada em</th>
          </tr>
        </thead>
        <tbody>${contasRows}</tbody>
      </table>`
      : `<p class="muted">Nenhuma conta fechada neste intervalo.</p>`
  }

  <p class="foot">${MARCA.assinatura} · Relatório operacional · ${esc(from)} a ${esc(to)}</p>
  <script>
    /* não auto-print: usuário confirma layout antes de salvar PDF */
  </script>
</body>
</html>`;

  const w = window.open("about:blank", "_blank", "width=960,height=800");
  if (!w) {
    alert("Permita pop-ups para abrir o relatório");
    return;
  }
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch (e) {
    console.warn("[relatorio]", e);
    alert("Não foi possível abrir o relatório.");
  }
}

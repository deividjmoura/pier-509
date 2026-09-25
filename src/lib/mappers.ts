import type {
  Categoria,
  FormaPagamento,
  ItemPedido,
  Mesa,
  Pedido,
  PedidoStatus,
  Produto,
  Sessao,
} from "./types";

/** URL de foto usável no browser (proxy Vite cobre /uploads). */
export function fotoSrc(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (s.startsWith("data:") || s.startsWith("blob:") || /^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return s;
  return s;
}

export const FOTO_PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
      <rect fill="#1a1714" width="400" height="300"/>
      <text x="200" y="155" text-anchor="middle" fill="#a8a29e" font-family="system-ui" font-size="18">sem foto</text>
    </svg>`
  );

/** Backend → UI */
export function statusToUi(s: string): PedidoStatus {
  switch (s) {
    case "recebido":
      return "na_fila";
    case "em_producao":
      return "em_producao";
    case "concluido":
      return "pronto";
    case "entregue":
      return "entregue";
    default:
      return "na_fila";
  }
}

/** UI → Backend (PATCH status) */
export function statusToApi(s: PedidoStatus): string {
  switch (s) {
    case "na_fila":
      return "recebido";
    case "em_producao":
      return "em_producao";
    case "pronto":
      return "concluido";
    case "entregue":
      return "entregue";
  }
}

/** forma do backend → UI */
export function formaFromApi(raw: string | undefined | null): FormaPagamento {
  const f = String(raw || "pix").toLowerCase();
  if (f === "cartao_credito" || f === "credito") return "credito";
  if (f === "cartao_debito" || f === "debito") return "debito";
  if (f === "dinheiro") return "dinheiro";
  return "pix";
}

export function mapCardapio(apiCats: any[]): { categorias: Categoria[]; produtos: Produto[] } {
  const categorias: Categoria[] = (apiCats || []).map((c, i) => ({
    id: Number(c.id),
    nome: String(c.nome),
    ordem: c.ordem != null ? Number(c.ordem) : i,
  }));

  const produtos: Produto[] = [];
  for (const c of apiCats || []) {
    for (const p of c.produtos || []) {
      const adicionaisBrutos: { id: string; nome: string; preco: number }[] = (p.adicionais || []).map((a: any) => ({
        id: String(a.id),
        nome: String(a.nome),
        preco: Number(a.preco) || 0,
      }));
      // blindagem: se já existem linhas duplicadas no banco (mesmo nome), o modal
      // não deve exibir a mesma opção 2x — mantém a primeira ocorrência
      const nomesVistos = new Set<string>();
      const adicionais = adicionaisBrutos.filter((a: { id: string; nome: string; preco: number }) => {
        const k = a.nome.trim().toLowerCase();
        if (nomesVistos.has(k)) return false;
        nomesVistos.add(k);
        return true;
      });
      const removiveis = (p.removiveis || []).map((nome: string, i: number) => ({
        id: `r-${p.id}-${i}`,
        nome: String(nome),
      }));
      const tipo =
        adicionais.length === 1 && !removiveis.length
          ? ("escolher" as const)
          : adicionais.length || removiveis.length
            ? ("personalizavel" as const)
            : ("simples" as const);
      const controla = Boolean(p.controlaEstoque ?? p.controla_estoque);
      const estoqueRaw = p.estoque;
      const estoque =
        controla || (estoqueRaw !== undefined && estoqueRaw !== null)
          ? Number(estoqueRaw ?? 0)
          : null;
      produtos.push({
        id: Number(p.id),
        nome: String(p.nome),
        descricao: String(p.descricao || ""),
        preco: Number(p.preco) || 0,
        categoria: String(c.nome),
        categoriaOrdem: c.ordem != null ? Number(c.ordem) : 0,
        ordem: p.ordem != null ? Number(p.ordem) : 0,
        foto: fotoSrc(p.fotoUrl || p.foto_url || "") || FOTO_PLACEHOLDER,
        setor: p.setor === "bar" ? "bar" : "cozinha",
        tipo,
        adicionais,
        removiveis,
        ativo: p.disponivel === undefined ? true : Boolean(p.disponivel),
        estoque: controla ? (estoque ?? 0) : estoque,
        vendidos: 0,
      });
    }
  }
  return { categorias, produtos };
}

export function mapMesas(rows: any[]): Mesa[] {
  return (rows || []).map((m) => ({
    id: Number(m.id),
    numero: Number(m.numero),
    token: String(m.token),
    nome: `Mesa ${String(m.numero).padStart(2, "0")}`,
  }));
}

export function mapSessaoFromMesaApi(_token: string, mesaMeta: Mesa | undefined, data: any): {
  sessao: Sessao | null;
  pedidos: Pedido[];
} {
  if (!data || !data.sessaoAberta) {
    return { sessao: null, pedidos: [] };
  }
  const mesaId = mesaMeta?.id || 0;
  const mesaNome = mesaMeta?.nome || `Mesa ${data.mesa ?? "?"}`;
  /* GET /api/mesas/:token/sessao devolve totalDevido/valorPago/valorRestante.
     Estes campos eram descartados, então consumoSessao() caía no fallback de
     recalcular a partir dos pedidos — que ignora desconto, taxa e pagamentos
     parciais já lançados pelo caixa. */
  const totalDevido = Number(data.totalDevido ?? data.valorTotal ?? 0);
  const valorPago = Number(data.valorPago ?? 0);
  const sessao: Sessao = {
    id: Number(data.sessaoId),
    mesaId,
    mesaNome,
    status: "aberta",
    abertaEm: data.abertaEm ? new Date(data.abertaEm).getTime() : Date.now(),
    fechadaEm: null,
    pagamentos: [],
    pixAvisos: Array.isArray(data.pixAvisos) ? data.pixAvisos.length : 0,
    desconto: 0,
    taxa: 0,
    valorTotal: totalDevido,
    valorPago,
    valorRestante: Number(data.valorRestante ?? Math.max(0, totalDevido - valorPago)),
    clienteNome: data.clienteNome ?? null,
  };

  const pedidos: Pedido[] = (data.pedidos || []).map((p: any) => {
    const itens: ItemPedido[] = (p.itens || []).map((it: any, idx: number) => {
      const adds = (it.adicionais || []).map((a: any) => ({
        id: String(a.adicional_id || a.id || idx),
        nome: String(a.nome || ""),
        preco: Number(a.preco_unitario ?? a.preco ?? 0),
      }));
      const qtd = Number(it.quantidade || it.qty || 1);
      const precoBase = Number(it.preco_unitario ?? it.preco ?? 0);
      const totalLinha = Number(it.totalLinha ?? qtd * (precoBase + adds.reduce((s: number, a: any) => s + a.preco, 0)));
      return {
        id: String(it.id || `${p.id}-${idx}`),
        produtoId: Number(it.produto_id || it.produtoId || 0),
        nome: String(it.nome || "Item"),
        qtd,
        precoBase,
        adicionais: adds,
        removidos: (it.remocoes || it.removals || []).map((r: any) => (typeof r === "string" ? r : r.ingrediente || "")),
        escolha: null,
        obs: String(it.observacao || it.note || ""),
        totalUnit: qtd ? totalLinha / qtd : precoBase,
        status: (["recebido","em_producao","concluido","entregue"].includes(String(it.status || ""))
          ? (String(it.status) as any)
          : "recebido"),
        setor: it.setor === "bar" ? "bar" as const : "cozinha" as const,
      };
    });
    const total = Number(p.totalPedido ?? itens.reduce((s, i) => s + i.totalUnit * i.qtd, 0));
    return {
      id: Number(p.id),
      sessaoId: sessao.id,
      mesaId,
      mesaNome,
      clienteNome: String(p.cliente_nome || p.clienteNome || data.clienteNome || ""),
      itens,
      status: statusToUi(String(p.status)),
      criadoEm: p.criado_em || p.criadoEm ? new Date(p.criado_em || p.criadoEm).getTime() : Date.now(),
      total,
    };
  });

  return { sessao, pedidos };
}

export function mapCozinhaPedidos(rows: any[]): Pedido[] {
  return (rows || []).map((p) => {
    const itens: ItemPedido[] = (p.itens || []).map((it: any, idx: number) => {
      const adds = (it.adicionais || []).map((a: any) => ({
        id: String(a.id || a.adicional_id || idx),
        nome: String(a.nome || ""),
        preco: Number(a.preco || a.preco_unitario || 0),
      }));
      const qtd = Number(it.quantidade || 1);
      const precoBase = Number(it.preco_unitario || it.preco || 0);
      return {
        id: String(it.id || idx),
        produtoId: Number(it.produto_id || 0),
        nome: String(it.nome || it.produto_nome || "Item"),
        qtd,
        precoBase,
        adicionais: adds,
        removidos: (it.remocoes || []).map((r: any) => (typeof r === "string" ? r : r.ingrediente)),
        escolha: null,
        obs: String(it.observacao || ""),
        totalUnit: precoBase + adds.reduce((s: number, a: any) => s + a.preco, 0),
        status: (["recebido","em_producao","concluido","entregue"].includes(String(it.status || ""))
          ? (String(it.status) as any)
          : "recebido"),
        setor: it.setor === "bar" ? "bar" as const : "cozinha" as const,
      };
    });
    return {
      id: Number(p.id),
      sessaoId: Number(p.sessao_id || p.sessaoId || 0),
      mesaId: Number(p.mesa_id || p.mesaId || 0),
      mesaNome: (p.mesa != null || p.mesa_numero != null)
        ? `Mesa ${String(p.mesa ?? p.mesa_numero).padStart(2, "0")}`
        : String(p.mesaNome || "Mesa"),
      clienteNome: String(p.cliente_nome || p.clienteNome || ""),
      itens,
      status: statusToUi(String(p.status)),
      criadoEm: p.criado_em || p.criadoEm ? new Date(p.criado_em || p.criadoEm).getTime() : Date.now(),
      total: itens.reduce((s, i) => s + i.totalUnit * i.qtd, 0),
    };
  });
}

export function mapCaixaSessoes(rows: any[]): { sessoes: Sessao[]; pedidos: Pedido[] } {
  const sessoes: Sessao[] = [];
  const pedidos: Pedido[] = [];
  for (const s of rows || []) {
    const numero = s.mesa != null ? s.mesa : s.mesa_numero != null ? s.mesa_numero : null;
    const mesaNome =
      numero != null
        ? `Mesa ${String(numero).padStart(2, "0")}`
        : String(s.mesaNome || s.mesa_nome || "Mesa");
    const mesaId = Number(s.mesaId || s.mesa_id || numero || 0);

    const pagamentos = (s.pagamentos || []).map((p: any) => ({
      id: Number(p.id),
      valor: Number(p.valor),
      forma: formaFromApi(p.formaPagamento || p.forma_pagamento || p.forma),
      criadoEm: p.criadoEm || p.criado_em ? new Date(p.criadoEm || p.criado_em).getTime() : Date.now(),
    }));

    const valorTotal = Number(s.valorTotal ?? s.valor_total ?? 0);
    const valorPagoApi = Number(s.valorPago ?? s.valor_pago ?? pagamentos.reduce((a: number, p: any) => a + p.valor, 0));

    sessoes.push({
      id: Number(s.id),
      mesaId,
      mesaNome,
      status: "aberta",
      abertaEm: s.abertaEm || s.aberta_em ? new Date(s.abertaEm || s.aberta_em).getTime() : Date.now(),
      fechadaEm: null,
      pagamentos,
      pixAvisos: Array.isArray(s.pixAvisos) ? s.pixAvisos.length : Number(s.pix_avisos || 0),
      desconto: Number(s.desconto || 0),
      taxa: Number(s.taxa ?? s.taxa_servico ?? 0),
      valorTotal,
      valorPago: valorPagoApi,
      valorRestante: Number(
        s.valorRestante ?? s.valor_restante ?? Math.max(0, valorTotal - valorPagoApi)
      ),
      pedidosPendentes: Number(s.pedidosPendentes ?? s.pedidos_pendentes ?? 0),
      podeFechar: s.podeFechar != null ? Boolean(s.podeFechar) : Number(s.pedidosPendentes || 0) === 0,
      clienteNome: s.clienteNome || s.cliente_nome || null,
    });

    /* API devolve pedidosEntregues (já só entregues) — fallback s.pedidos */
    const listaPedidos = s.pedidosEntregues || s.pedidos || [];
    for (const p of listaPedidos) {
      const itens: ItemPedido[] = (p.itens || []).map((it: any, idx: number) => {
        const adds = (it.adicionais || []).map((a: any, i: number) => ({
          id: String(a.id || i),
          nome: String(a.nome || ""),
          preco: Number(a.preco_unitario ?? a.preco ?? 0),
        }));
        const qtd = Number(it.quantidade || it.qtd || 1);
        const precoBase = Number(it.preco_unitario ?? it.precoUnitario ?? it.preco ?? 0);
        const sub = Number(it.subtotal ?? it.totalLinha ?? qtd * (precoBase + adds.reduce((x: number, a: any) => x + a.preco, 0)));
        return {
          id: String(it.id || idx),
          produtoId: Number(it.produto_id || it.produtoId || 0),
          nome: String(it.nome || "Item"),
          qtd,
          precoBase,
          adicionais: adds,
          removidos: it.remocoes || it.removidos || [],
          escolha: null,
          obs: String(it.observacao || it.obs || ""),
          totalUnit: qtd > 0 ? sub / qtd : precoBase,
          status: (["recebido","em_producao","concluido","entregue"].includes(String(it.status || ""))
            ? (String(it.status) as any)
            : "recebido"),
          setor: it.setor === "bar" ? "bar" as const : "cozinha" as const,
        };
      });
      const total = Number(p.total ?? p.totalPedido ?? itens.reduce((a, i) => a + i.totalUnit * i.qtd, 0));
      pedidos.push({
        id: Number(p.id),
        sessaoId: Number(s.id),
        mesaId,
        mesaNome,
        clienteNome: String(p.clienteNome || p.cliente_nome || s.clienteNome || ""),
        itens,
        status: "entregue",
        criadoEm: p.criadoEm || p.criado_em ? new Date(p.criadoEm || p.criado_em).getTime() : Date.now(),
        total,
      });
    }
  }
  return { sessoes, pedidos };
}

/** ItemPedido (UI) → body da API de pedido */
export function itensToApiBody(itens: ItemPedido[]) {
  return itens.map((i) => ({
    productId: i.produtoId,
    qty: i.qtd,
    additions: [
      ...i.adicionais.map((a) => ({ id: Number(a.id) || a.id })),
      ...(i.escolha ? [{ id: Number(i.escolha.id) || i.escolha.id }] : []),
    ],
    removals: i.removidos || [],
    note: i.obs || "",
  }));
}

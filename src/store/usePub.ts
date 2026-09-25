import { create } from "zustand";
import type {
  Categoria,
  Evento,
  EventoTipo,
  FormaPagamento,
  ItemPedido,
  Mesa,
  Pedido,
  Produto,
  Role,
  Sessao,
} from "../lib/types";
import { api } from "../lib/api";
import { avisar, confirmar } from "../components/Dialogos";
import {
  itensToApiBody,
  mapCaixaSessoes,
  mapCardapio,
  mapCozinhaPedidos,
  mapMesas,
  mapSessaoFromMesaApi,
  statusToApi,
} from "../lib/mappers";

interface PubState {
  mesas: Mesa[];
  produtos: Produto[];
  categorias: Categoria[];
  sessoes: Sessao[];
  pedidos: Pedido[];
  eventos: Evento[];
  auth: { role: Role; nome: string } | null;
  somLigado: boolean;
  loading: boolean;
  apiReady: boolean;
  lastError: string | null;
  seqEvento: number;

  /* bootstrap / refresh */
  hydrateCardapio: () => Promise<void>;
  hydrateMesas: () => Promise<void>;
  hydrateMesaToken: (token: string) => Promise<void>;
  hydrateCozinha: () => Promise<void>;
  hydrateBar: () => Promise<void>;
  hydrateGarcom: (token: string) => Promise<void>;
  hydrateCaixa: () => Promise<void>;
  hydrateMe: () => Promise<void>;

  /* cliente / mesa */
  criarPedido: (mesaId: number, clienteNome: string, itens: ItemPedido[]) => number | null;
  cancelarPedido: (pedidoId: number) => boolean;
  editarPedido: (pedidoId: number, itens: ItemPedido[]) => boolean;
  informarPix: (mesaId: number) => void;

  /* cozinha */
  aceitarPedido: (pedidoId: number, setor?: "cozinha" | "bar") => void;
  concluirPedido: (pedidoId: number, setor?: "cozinha" | "bar") => void;

  /* garçom */
  entregarPedido: (pedidoId: number, garcomToken?: string, itemIds?: number[]) => void;

  /* caixa */
  registrarPagamento: (sessaoId: number, valor: number, forma: FormaPagamento) => void;
  setDesconto: (sessaoId: number, valor: number) => void;
  setTaxa: (sessaoId: number, valor: number) => void;
  fecharSessao: (sessaoId: number, forma: FormaPagamento) => void;

  /* admin (local + best-effort API depois) */
  upsertProduto: (p: Produto) => Promise<void>;
  removerProduto: (id: number) => void;
  toggleProduto: (id: number) => void;
  ajustarEstoque: (id: number, delta: number) => void;
  setEstoque: (id: number, valor: number) => void;
  ativarControleEstoque: (id: number, valor: number) => void;
  addCategoria: (nome: string) => void;
  renameCategoria: (id: number, nome: string) => void;
  removeCategoria: (id: number) => void;
  moverCategoria: (id: number, delta: -1 | 1) => void;
  setCategoriasOrdem: (ids: number[]) => void;

  /* auth + som */
  login: (usuario: string, senha: string) => Role | null;
  loginApi: (usuario: string, senha: string) => Promise<Role | null>;
  logout: () => void;
  toggleSom: () => void;
  limparEventos: () => void;
}

const emit = (get: () => PubState, set: (p: Partial<PubState>) => void, tipo: EventoTipo, texto: string, mesaNome?: string) => {
  const seqEvento = get().seqEvento + 1;
  const eventos = [...get().eventos, { seq: seqEvento, tipo, texto, mesaNome, em: Date.now() }].slice(-40);
  set({ eventos, seqEvento });
};

/* ---------- sessão do staff no dispositivo ----------
   sessionStorage pode lançar (modo privado/bloqueado) e o JSON pode estar
   corrompido: nenhum dos dois pode derrubar o app no boot. */
const CHAVE_AUTH = "pier509-auth";

function lerAuthSalva(): { role: Role; nome: string } | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_AUTH);
    if (!bruto) return null;
    const dados = JSON.parse(bruto);
    if (dados && typeof dados.role === "string") {
      return { role: dados.role as Role, nome: String(dados.nome || dados.role) };
    }
  } catch {
    /* JSON inválido ou armazenamento bloqueado — a guarda resolve via /api/me */
  }
  return null;
}

function gravarAuth(auth: { role: Role; nome: string } | null) {
  try {
    if (auth) sessionStorage.setItem(CHAVE_AUTH, JSON.stringify(auth));
    else sessionStorage.removeItem(CHAVE_AUTH);
  } catch {
    /* armazenamento indisponível: a sessão continua válida no cookie do servidor */
  }
}

const sessaoAberta = (sessoes: Sessao[], mesaId: number) =>
  sessoes.find((s) => s.mesaId === mesaId && s.status === "aberta");

function formaToApi(forma: FormaPagamento): string {
  if (forma === "credito") return "cartao_credito";
  if (forma === "debito") return "cartao_debito";
  return forma;
}

function mesaToken(get: () => PubState, mesaId: number): string | null {
  return get().mesas.find((m) => m.id === mesaId)?.token || null;
}

function tokenByPedido(get: () => PubState, pedidoId: number): string | null {
  const p = get().pedidos.find((x) => x.id === pedidoId);
  if (!p) return null;
  return mesaToken(get, p.mesaId);
}

/** desconto/taxa só existem no body do fechar — preservamos entre hydrates */
const ajustesCaixaLocais = new Map<number, { desconto: number; taxa: number }>();

/* primeiro hydrate não anuncia fila já existente */
let anuncioCozinhaPronto = false;
let anuncioGarcomPronto = false;

/** Evita que SSE/poll sobrescreva UI no meio de um PATCH (flicker some/volta). */
let opsMutating = 0;
function beginOpsMutation() {
  opsMutating += 1;
}
function endOpsMutation() {
  opsMutating = Math.max(0, opsMutating - 1);
}

/** Assinatura estável da fila — se igual, não chama set() (sem re-render). */
function filaSig(list: { id: number; status: string; itens?: { id: string; status?: string }[] }[]) {
  return list
    .map((p) => {
      const itens = (p.itens || [])
        .map((i) => `${i.id}:${i.status || ""}`)
        .join(",");
      return `${p.id}|${p.status}|${itens}`;
    })
    .join(";");
}

export const usePub = create<PubState>((set, get) => ({
  mesas: [],
  produtos: [],
  categorias: [],
  sessoes: [],
  pedidos: [],
  eventos: [],
  auth: lerAuthSalva(),
  somLigado: true,
  loading: false,
  apiReady: false,
  lastError: null,
  seqEvento: 0,

  hydrateCardapio: async () => {
    try {
      const isAdmin = get().auth?.role === "admin";
      const raw = isAdmin ? await api.adminCardapio() : await api.cardapio();
      const { categorias, produtos } = mapCardapio(raw);
      set({ categorias, produtos, apiReady: true, lastError: null });
    } catch (e: any) {
      /* admin sem permissão → tenta público */
      try {
        const raw = await api.cardapio();
        const { categorias, produtos } = mapCardapio(raw);
        set({ categorias, produtos, apiReady: true, lastError: null });
      } catch (e2: any) {
        set({ lastError: e2.message || e.message || "Falha ao carregar cardápio" });
      }
    }
  },

  hydrateMesas: async () => {
    try {
      let rows: any[];
      try {
        rows = await api.mesasPublic();
      } catch {
        rows = await api.adminMesas();
      }
      set({ mesas: mapMesas(rows), lastError: null });
    } catch (e: any) {
      set({ lastError: e.message || "Falha ao carregar mesas" });
    }
  },

  hydrateMesaToken: async (token: string) => {
    try {
      set({ loading: true });
      /* sessão da mesa é obrigatória; cardápio tenta em separado para não marcar QR inválido se o menu falhar */
      let sess: any;
      try {
        sess = await api.mesaSessao(token);
      } catch (e: any) {
        set({
          loading: false,
          lastError: e.message || "Falha ao carregar mesa",
        });
        return;
      }

      let categorias = get().categorias;
      let produtos = get().produtos;
      try {
        const card = await api.cardapio();
        const mapped = mapCardapio(card);
        categorias = mapped.categorias;
        produtos = mapped.produtos;
      } catch (e: any) {
        console.warn("[hydrateMesaToken] cardápio:", e?.message || e);
        /* mantém cardápio anterior se houver; senão UI avisa */
        if (!produtos.length) {
          set({ lastError: e.message || "Cardápio indisponível no momento" });
        }
      }

      let mesas = get().mesas;
      let mesa = mesas.find((m) => m.token === token);
      if (!mesa) {
        const numero = Number(sess.mesa) || Number(sess.mesaNumero) || 0;
        mesa = {
          id: Number(sess.mesaId) || numero || Date.now(),
          numero,
          token,
          nome: sess.mesaNome || `Mesa ${String(numero).padStart(2, "0")}`,
        };
        mesas = [...mesas.filter((m) => m.token !== token), mesa];
      }

      const { sessao, pedidos } = mapSessaoFromMesaApi(token, mesa, sess);
      const otherSessoes = get().sessoes.filter((s) => s.mesaId !== mesa!.id);
      const otherPedidos = get().pedidos.filter((p) => p.mesaId !== mesa!.id);

      set({
        categorias,
        produtos,
        mesas,
        sessoes: sessao ? [...otherSessoes, sessao] : otherSessoes,
        pedidos: [...otherPedidos, ...pedidos],
        loading: false,
        apiReady: true,
        lastError: produtos.length ? null : get().lastError,
      });
    } catch (e: any) {
      set({ loading: false, lastError: e.message || "Falha ao carregar mesa" });
    }
  },

  hydrateBar: async () => {
    if (opsMutating > 0) return;
    try {
      const rows = await api.barPedidos();
      if (opsMutating > 0) return;
      const fila = mapCozinhaPedidos(rows);
      const prev = get().pedidos;
      const prevIds = new Set(prev.map((p) => p.id));
      const prevById = new Map(prev.map((p) => [p.id, p]));
      for (const p of fila) {
        if (p.status === "na_fila" && !prevIds.has(p.id)) {
          emit(get, set, "pedido-novo", p.clienteNome || "Cliente", p.mesaNome);
        }
        const before = prevById.get(p.id);
        if (p.status === "pronto" && (!before || before.status !== "pronto")) {
          emit(get, set, "pedido-pronto", `Pronto · ${p.clienteNome || "cliente"}`, p.mesaNome);
        }
      }
      const ativosIds = new Set(fila.map((p) => p.id));
      const rest = prev.filter((p) => !ativosIds.has(p.id) && p.status === "entregue");
      const next = [...fila, ...rest];
      if (filaSig(next) === filaSig(prev)) {
        set({ lastError: null, apiReady: true });
        return;
      }
      set({ pedidos: next, lastError: null, apiReady: true });
    } catch (e: any) {
      const msg = e.message || "Falha ao carregar bar";
      set({ lastError: msg });
      console.warn("[hydrateBar]", msg);
    }
  },

  hydrateCozinha: async () => {
    if (opsMutating > 0) return;
    try {
      const rows = await api.cozinhaPedidos();
      if (opsMutating > 0) return;
      const cozinha = mapCozinhaPedidos(rows);
      const prev = get().pedidos;
      const prevIds = new Set(prev.map((p) => p.id));
      const prevById = new Map(prev.map((p) => [p.id, p]));
      if (anuncioCozinhaPronto) {
        for (const p of cozinha) {
          if (p.status === "na_fila" && !prevIds.has(p.id)) {
            emit(get, set, "pedido-novo", p.clienteNome || "Cliente", p.mesaNome);
          }
          const before = prevById.get(p.id);
          /* anuncios de pronto: transição real ou pedido que já chega como pronto */
          if (p.status === "pronto" && (!before || before.status !== "pronto")) {
            emit(get, set, "pedido-pronto", `Pronto · ${p.clienteNome || "cliente"}`, p.mesaNome);
          }
        }
      }
      anuncioCozinhaPronto = true;
      const ativosIds = new Set(cozinha.map((p) => p.id));
      /* API agora traz na_fila + em_producao + pronto.
         Preserva só entregues (e outros que não sejam da fila ativa da cozinha). */
      const rest = prev.filter(
        (p) => !ativosIds.has(p.id) && p.status === "entregue"
      );
      const next = [...cozinha, ...rest];
      if (filaSig(next) === filaSig(prev)) {
        set({ lastError: null, apiReady: true });
        return;
      }
      set({ pedidos: next, lastError: null, apiReady: true });
    } catch (e: any) {
      const msg = e.message || "Falha ao carregar cozinha";
      set({ lastError: msg });
      console.warn("[hydrateCozinha]", msg);
    }
  },

  hydrateGarcom: async (token: string) => {
    if (opsMutating > 0) return;
    try {
      const rows = await api.garcomPedidos(token);
      if (opsMutating > 0) return;
      /* fila do garçom = só concluido no backend → status UI "pronto" */
      const prontos = mapCozinhaPedidos(rows).map((p) => ({ ...p, status: "pronto" as const }));
      const prontoIds = new Set(prontos.map((p) => p.id));
      const prev = get().pedidos;
      const prevProntos = new Set(
        prev.filter((p) => p.status === "pronto").map((p) => p.id)
      );
      if (anuncioGarcomPronto) {
        for (const p of prontos) {
          if (!prevProntos.has(p.id)) {
            emit(get, set, "pedido-pronto", `Pronto · ${p.clienteNome || "cliente"}`, p.mesaNome);
          }
        }
      }
      anuncioGarcomPronto = true;
      /* não apaga na_fila/em_producao; entrega local fica; prontos vêm só da API */
      const othersSemProntosAntigos = prev.filter(
        (p) => p.status !== "pronto" && (p.status !== "entregue" || !prontoIds.has(p.id))
      );
      const next = [...prontos, ...othersSemProntosAntigos];
      if (filaSig(next) === filaSig(prev)) {
        set({ lastError: null });
        return;
      }
      set({ pedidos: next, lastError: null });
    } catch (e: any) {
      set({ lastError: e.message || "Falha ao carregar fila do garçom" });
    }
  },

  hydrateCaixa: async () => {
    try {
      const rows = await api.caixaSessoes();
      const { sessoes: raw, pedidos: entregues } = mapCaixaSessoes(rows);
      const idsVivos = new Set(raw.map((s) => s.id));
      for (const id of [...ajustesCaixaLocais.keys()]) {
        if (!idsVivos.has(id)) ajustesCaixaLocais.delete(id);
      }
      const sessoes = raw.map((s) => {
        const aj = ajustesCaixaLocais.get(s.id);
        if (!aj) return s;
        return { ...s, desconto: aj.desconto, taxa: aj.taxa };
      });
      /* NÃO apagar fila da cozinha/garçom: só mescla entregues do caixa */
      const ativos = get().pedidos.filter((p) =>
        p.status === "na_fila" || p.status === "em_producao" || p.status === "pronto"
      );
      const entregueIds = new Set(entregues.map((p) => p.id));
      const ativosSemEntregue = ativos.filter((p) => !entregueIds.has(p.id));
      set({ sessoes, pedidos: [...ativosSemEntregue, ...entregues], lastError: null });
    } catch (e: any) {
      set({ lastError: e.message || "Falha ao carregar caixa" });
    }
  },

  hydrateMe: async () => {
    try {
      const me = await api.me();
      const staff = me?.staff || me;
      if (staff && staff.papel) {
        const auth = { role: staff.papel as Role, nome: staff.nome || staff.papel };
        gravarAuth(auth);
        set({ auth });
      }
    } catch (_) {
      /* anônimo ok */
    }
  },

  criarPedido: (mesaId, clienteNome, itens) => {
    if (!itens.length) return null;
    const token = mesaToken(get, mesaId);
    if (!token) {
      set({ lastError: "Mesa sem token — recarregue a página" });
      return null;
    }
    const tempId = -Date.now();
    /* otimista: UI responde; API confirma em seguida */
    void (async () => {
      try {
        if (clienteNome) await api.checkin(token, clienteNome).catch(() => null);
        await api.criarPedido(token, {
          clienteNome,
          items: itensToApiBody(itens),
          note: "",
        });
        const mesaNome = get().mesas.find((m) => m.id === mesaId)?.nome;
        emit(get, set, "pedido-novo", `${clienteNome || "Cliente"}`, mesaNome);
        await get().hydrateMesaToken(token);
      } catch (e: any) {
        set({ lastError: e.message || "Erro ao enviar pedido" });
        avisar(e.message || "Erro ao enviar pedido");
      }
    })();
    return tempId;
  },

  cancelarPedido: (pedidoId) => {
    const token = tokenByPedido(get, pedidoId);
    if (!token) return false;
    void (async () => {
      try {
        await api.cancelarPedido(token, pedidoId);
        emit(get, set, "pedido-cancelado", `Pedido #${pedidoId} cancelado`);
        await get().hydrateMesaToken(token);
      } catch (e: any) {
        avisar(e.message || "Não foi possível cancelar");
      }
    })();
    return true;
  },

  editarPedido: (pedidoId, itens) => {
    const token = tokenByPedido(get, pedidoId);
    if (!token || !itens.length) return false;
    void (async () => {
      try {
        await api.editarPedido(token, pedidoId, { items: itensToApiBody(itens), note: "" });
        await get().hydrateMesaToken(token);
      } catch (e: any) {
        avisar(e.message || "Não foi possível editar");
      }
    })();
    return true;
  },

  informarPix: (mesaId) => {
    const token = mesaToken(get, mesaId);
    if (!token) return;
    void (async () => {
      try {
        await api.pixInformado(token, {});
        emit(get, set, "pix-avisado", "Cliente avisou PIX", get().mesas.find((m) => m.id === mesaId)?.nome);
        await get().hydrateMesaToken(token);
      } catch (e: any) {
        avisar(e.message || "Erro ao avisar PIX");
      }
    })();
  },

  aceitarPedido: (pedidoId, setor) => {
    const antes = get().pedidos.find((x) => x.id === pedidoId);
    beginOpsMutation();
    set({
      pedidos: get().pedidos.map((p) =>
        p.id === pedidoId
          ? {
              ...p,
              status: "em_producao" as const,
              itens: p.itens.map((it) =>
                !setor || it.setor === setor
                  ? { ...it, status: it.status === "recebido" ? ("em_producao" as const) : it.status }
                  : it
              ),
            }
          : p
      ),
    });
    void (async () => {
      try {
        await api.statusPedido(pedidoId, statusToApi("em_producao"), setor);
        emit(get, set, "pedido-aceito", `Pedido #${pedidoId} em produção`, antes?.mesaNome);
        endOpsMutation();
        if (setor === "bar") await get().hydrateBar();
        else await get().hydrateCozinha();
      } catch (e: any) {
        endOpsMutation();
        if (antes) {
          set({
            pedidos: get().pedidos.map((p) => (p.id === pedidoId ? antes : p)),
          });
        }
        avisar(e.message || "Erro ao aceitar");
      }
    })();
  },

  concluirPedido: (pedidoId, setor) => {
    const antes = get().pedidos.find((x) => x.id === pedidoId);
    beginOpsMutation();
    set({
      pedidos: get().pedidos.map((p) => {
        if (p.id !== pedidoId) return p;
        const itens = p.itens.map((it) =>
          !setor || it.setor === setor
            ? {
                ...it,
                status:
                  it.status === "recebido" || it.status === "em_producao"
                    ? ("concluido" as const)
                    : it.status,
              }
            : it
        );
        /* Se ainda há itens de outro setor em produção, não marca o pedido inteiro como pronto */
        const aindaPend = itens.some(
          (it) => it.status === "recebido" || it.status === "em_producao"
        );
        return {
          ...p,
          itens,
          status: aindaPend ? ("em_producao" as const) : ("pronto" as const),
        };
      }),
    });
    void (async () => {
      try {
        await api.statusPedido(pedidoId, statusToApi("pronto"), setor);
        emit(
          get,
          set,
          "pedido-pronto",
          `Pronto · ${antes?.clienteNome || "cliente"}`,
          antes?.mesaNome
        );
        endOpsMutation();
        if (setor === "bar") await get().hydrateBar();
        else await get().hydrateCozinha();
      } catch (e: any) {
        endOpsMutation();
        if (antes) {
          set({
            pedidos: get().pedidos.map((p) => (p.id === pedidoId ? antes : p)),
          });
        }
        avisar(e.message || "Erro ao concluir");
      }
    })();
  },

  entregarPedido: (pedidoId, garcomToken, itemIds) => {
    /* otimista: marca itens entregues; se sobrar concluido, mantém na fila do garçom */
    const antes = get().pedidos.find((p) => p.id === pedidoId);
    const idsSet =
      Array.isArray(itemIds) && itemIds.length
        ? new Set(itemIds.map((n) => Number(n)))
        : null;
    beginOpsMutation();
    set({
      pedidos: get().pedidos.map((p) => {
        if (p.id !== pedidoId) return p;
        const itens = p.itens.map((it) => {
          const idNum = Number(it.id);
          const target =
            it.status === "concluido" &&
            (idsSet == null || idsSet.has(idNum));
          return target ? { ...it, status: "entregue" as const } : it;
        });
        const aindaPronto = itens.some((it) => it.status === "concluido");
        const tudoEntregue = itens.every((it) => it.status === "entregue");
        return {
          ...p,
          itens,
          status: tudoEntregue
            ? ("entregue" as const)
            : aindaPronto
              ? ("pronto" as const)
              : p.status === "pronto"
                ? ("em_producao" as const)
                : p.status,
        };
      }),
    });
    void (async () => {
      try {
        if (garcomToken) {
          await api.garcomEntregar(garcomToken, pedidoId, itemIds);
          endOpsMutation();
          await get().hydrateGarcom(garcomToken);
        } else {
          await api.statusPedido(pedidoId, statusToApi("entregue"));
          endOpsMutation();
          await get().hydrateCozinha();
        }
        emit(
          get,
          set,
          "pedido-entregue",
          `Pedido #${pedidoId} entregue`,
          antes?.mesaNome
        );
        await get().hydrateCaixa().catch(() => null);
      } catch (e: any) {
        endOpsMutation();
        const msg = String(e?.message || "");
        /* Já entregue no servidor: NÃO reverte — senão o card volta como zumbi */
        if (/já.*entregue|totalmente entregue|already/i.test(msg)) {
          set({
            pedidos: get().pedidos.map((p) =>
              p.id === pedidoId
                ? {
                    ...p,
                    status: "entregue" as const,
                    itens: p.itens.map((it) => ({ ...it, status: "entregue" as const })),
                  }
                : p
            ),
          });
          if (garcomToken) await get().hydrateGarcom(garcomToken).catch(() => null);
          return;
        }
        if (antes) {
          set({
            pedidos: get().pedidos.map((p) => (p.id === pedidoId ? antes : p)),
          });
        }
        avisar(msg || "Erro ao entregar");
      }
    })();
  },

  registrarPagamento: (sessaoId, valor, forma) => {
    void (async () => {
      try {
        await api.registrarPagamento(sessaoId, valor, formaToApi(forma));
        await get().hydrateCaixa();
      } catch (e: any) {
        avisar(e.message || "Erro no pagamento");
      }
    })();
  },

  setDesconto: (sessaoId, valor) => {
    const v = Math.max(0, Number(valor) || 0);
    const prev = ajustesCaixaLocais.get(sessaoId) || { desconto: 0, taxa: 0 };
    ajustesCaixaLocais.set(sessaoId, { ...prev, desconto: v });
    set({
      sessoes: get().sessoes.map((s) => (s.id === sessaoId ? { ...s, desconto: v } : s)),
    });
  },
  setTaxa: (sessaoId, valor) => {
    const v = Math.max(0, Number(valor) || 0);
    const prev = ajustesCaixaLocais.get(sessaoId) || { desconto: 0, taxa: 0 };
    ajustesCaixaLocais.set(sessaoId, { ...prev, taxa: v });
    set({
      sessoes: get().sessoes.map((s) => (s.id === sessaoId ? { ...s, taxa: v } : s)),
    });
  },

  fecharSessao: (sessaoId, forma) => {
    void (async () => {
      try {
        const s = get().sessoes.find((x) => x.id === sessaoId);
        const aj = ajustesCaixaLocais.get(sessaoId);
        await api.fecharSessao(sessaoId, {
          formaPagamento: formaToApi(forma),
          desconto: aj?.desconto ?? s?.desconto ?? 0,
          taxaServico: aj?.taxa ?? s?.taxa ?? 0,
        });
        ajustesCaixaLocais.delete(sessaoId);
        emit(get, set, "sessao-fechada", `Sessão #${sessaoId} fechada`);
        await get().hydrateCaixa();
        await get().hydrateMesas().catch(() => null);
      } catch (e: any) {
        avisar(e.message || "Erro ao fechar sessão");
      }
    })();
  },

  /* admin → API real (persiste no Postgres) */
  upsertProduto: async (p) => {
    const st = get();
    const cat = st.categorias.find((c) => c.nome === p.categoria);
    if (!cat) {
      avisar("Selecione uma categoria válida");
      throw new Error("Categoria inválida");
    }
    const body = {
      nome: p.nome,
      descricao: p.descricao || "",
      preco: p.preco,
      categoriaId: cat.id,
      fotoUrl: p.foto && !p.foto.startsWith("data:image/svg") ? p.foto : null,
      disponivel: p.ativo !== false,
      controlaEstoque: p.estoque != null,
      estoque: p.estoque,
      estoqueMinimo: p.estoque != null ? 5 : 0,
      setor: p.setor === "bar" ? "bar" : "cozinha",
    };
    const exists = st.produtos.some((x) => x.id === p.id);
    const antes = exists ? st.produtos.find((x) => x.id === p.id) : null;
    let produtoId = p.id;
    try {
      if (exists) {
        await api.atualizarProduto(p.id, body);
        produtoId = p.id;
        await api.setRemoviveis(
          produtoId,
          (p.removiveis || []).map((r) => r.nome).filter(Boolean)
        );
        /* sync adicionais por nome (case-insensitive): remove sumidos, cria novos */
        const norm = (s: string) => s.trim().toLowerCase();
        const desejadosBrutos = (p.adicionais || [])
          .map((a) => ({
            nome: String(a.nome || "").trim(),
            preco: Number(a.preco) || 0,
          }))
          .filter((a) => a.nome);
        // dedup: o mesmo nome pode ter sido digitado 2x no campo de texto do Admin —
        // sem isso, cada ocorrência vira uma linha nova no banco (bug visto no modal
        // com marcas de bebida repetidas na seção "adições")
        const vistos = new Set<string>();
        const desejados = desejadosBrutos.filter((a) => {
          const k = norm(a.nome);
          if (vistos.has(k)) return false;
          vistos.add(k);
          return true;
        });
        const existentes = (antes?.adicionais || []).filter((a) => a.nome);
        const desejadosSet = new Set(desejados.map((a) => norm(a.nome)));
        for (const old of existentes) {
          if (!desejadosSet.has(norm(old.nome))) {
            const idNum = Number(old.id);
            if (Number.isFinite(idNum) && idNum > 0) {
              try {
                await api.removerAdicional(idNum);
              } catch (e: any) {
                /* 409 se já usado em pedido — avisa mas segue */
                console.warn("[adicional]", e?.message || e);
              }
            }
          }
        }
        const existentesSet = new Set(
          existentes.filter((a) => desejadosSet.has(norm(a.nome))).map((a) => norm(a.nome))
        );
        for (const a of desejados) {
          if (!existentesSet.has(norm(a.nome))) {
            await api.criarAdicional(produtoId, { nome: a.nome, preco: a.preco });
          }
        }
      } else {
        const created = await api.criarProduto(body);
        produtoId = Number(created.id);
        const vistosNovo = new Set<string>();
        for (const a of p.adicionais || []) {
          const nome = String(a.nome || "").trim();
          if (!nome) continue;
          const k = nome.trim().toLowerCase();
          if (vistosNovo.has(k)) continue;
          vistosNovo.add(k);
          await api.criarAdicional(produtoId, { nome, preco: a.preco || 0 });
        }
        const rems = (p.removiveis || []).map((r) => r.nome).filter(Boolean);
        if (rems.length) await api.setRemoviveis(produtoId, rems);
      }
      await get().hydrateCardapio();
      set({ lastError: null });
    } catch (e: any) {
      set({ lastError: e.message || "Erro ao salvar produto" });
      void get().hydrateCardapio();
      throw e;
    }
  },
  removerProduto: (id) => {
    void (async () => {
      try {
        await api.removerProdutoApi(id);
        await get().hydrateCardapio();
      } catch (e: any) {
        set({ lastError: e.message || "Erro ao remover produto" });
        avisar(e.message || "Erro ao remover produto");
        void get().hydrateCardapio();
      }
    })();
  },
  toggleProduto: (id) => {
    const p = get().produtos.find((x) => x.id === id);
    if (!p) return;
    const next = !p.ativo;
    set({
      produtos: get().produtos.map((x) => (x.id === id ? { ...x, ativo: next } : x)),
    });
    void (async () => {
      try {
        await api.atualizarProduto(id, { disponivel: next });
        await get().hydrateCardapio();
      } catch (e: any) {
        set({ lastError: e.message || "Erro ao alterar disponibilidade" });
        avisar(e.message || "Erro ao alterar disponibilidade");
        void get().hydrateCardapio();
      }
    })();
  },
  ajustarEstoque: (id, delta) => {
    const p = get().produtos.find((x) => x.id === id);
    if (!p || p.estoque == null) return;
    get().setEstoque(id, Math.max(0, p.estoque + delta));
  },
  setEstoque: (id, valor) => {
    const next = Math.max(0, Math.floor(Number(valor) || 0));
    set({
      produtos: get().produtos.map((x) => (x.id === id ? { ...x, estoque: next } : x)),
    });
    void (async () => {
      try {
        await api.atualizarProduto(id, { controlaEstoque: true, estoque: next });
        await get().hydrateCardapio();
      } catch (e: any) {
        set({ lastError: e.message || "Erro ao ajustar estoque" });
        avisar(e.message || "Erro ao ajustar estoque");
        void get().hydrateCardapio();
      }
    })();
  },
  ativarControleEstoque: (id, valor) => {
    const next = Math.max(0, Math.floor(Number(valor) || 0));
    set({
      produtos: get().produtos.map((x) => (x.id === id ? { ...x, estoque: next } : x)),
    });
    void (async () => {
      try {
        await api.atualizarProduto(id, { controlaEstoque: true, estoque: next });
        await get().hydrateCardapio();
      } catch (e: any) {
        avisar(e.message || "Erro ao ativar estoque");
        void get().hydrateCardapio();
      }
    })();
  },
  addCategoria: (nome) => {
    const n = nome.trim();
    if (!n) return;
    void (async () => {
      try {
        const ordem = get().categorias.length;
        await api.criarCategoria({ nome: n, ordem });
        await get().hydrateCardapio();
      } catch (e: any) {
        set({ lastError: e.message || "Erro ao criar categoria" });
        avisar(e.message || "Erro ao criar categoria");
      }
    })();
  },
  renameCategoria: (id, nome) => {
    const n = nome.trim();
    if (!n) return;
    void (async () => {
      try {
        await api.atualizarCategoria(id, { nome: n });
        await get().hydrateCardapio();
      } catch (e: any) {
        set({ lastError: e.message || "Erro ao renomear categoria" });
        avisar(e.message || "Erro ao renomear categoria");
        void get().hydrateCardapio();
      }
    })();
  },
  removeCategoria: (id) => {
    const st = get();
    const cat = st.categorias.find((c) => c.id === id);
    if (!cat) return;
    const nProd = st.produtos.filter((p) => p.categoria === cat.nome).length;
    const msg =
      nProd > 0
        ? `Excluir a categoria "${cat.nome}" e os ${nProd} produto(s) nela?\n\nIsso remove os itens do cardápio. Produtos que já aparecem em pedidos antigos não podem ser apagados — nesse caso a exclusão será bloqueada.`
        : `Excluir a categoria vazia "${cat.nome}"?`;
    void (async () => {
      if (!(await confirmar(msg))) return;
      try {
        const out = await api.removerCategoria(id);
        await get().hydrateCardapio();
        const n = out?.produtosRemovidos ?? nProd;
        if (n > 0) avisar(`Categoria "${cat.nome}" e ${n} produto(s) excluídos.`);
      } catch (e: any) {
        set({ lastError: e.message || "Erro ao excluir categoria" });
        avisar(e.message || "Erro ao excluir categoria");
        void get().hydrateCardapio();
      }
    })();
  },

  moverCategoria: (id, delta) => {
    const st = get();
    const sorted = [...st.categorias].sort((a, b) => a.ordem - b.ordem);
    const idx = sorted.findIndex((c) => c.id === id);
    const j = idx + delta;
    if (idx < 0 || j < 0 || j >= sorted.length) return;
    const ids = sorted.map((c) => c.id);
    const tmp = ids[idx];
    ids[idx] = ids[j];
    ids[j] = tmp;
    const categorias = st.categorias.map((c) => ({ ...c, ordem: ids.indexOf(c.id) }));
    set({ categorias });
    void api
      .reorderCategorias(ids)
      .then(() => get().hydrateCardapio())
      .catch((e: any) => {
        set({ lastError: e.message || "Falha ao reordenar categorias" });
        void get().hydrateCardapio();
      });
  },
  setCategoriasOrdem: (ids) => {
    const st = get();
    set({
      categorias: st.categorias.map((c) => {
        const i = ids.indexOf(c.id);
        return { ...c, ordem: i >= 0 ? i : c.ordem };
      }),
    });
    void api
      .reorderCategorias(ids)
      .then(() => get().hydrateCardapio())
      .catch((e: any) => {
        set({ lastError: e.message || "Falha ao reordenar categorias" });
        void get().hydrateCardapio();
      });
  },

  login: (_usuario, _senha) => {
    /* compat: preferir loginApi no Login.tsx */
    return null;
  },
  loginApi: async (usuario: string, senha: string): Promise<Role | null> => {
    try {
      const out = await api.login(usuario, senha);
      const r = (out.staff?.papel || "") as Role;
      if (!r) return null;
      const auth = { role: r, nome: out.staff?.nome || r };
      gravarAuth(auth);
      set({ auth, lastError: null });
      return r;
    } catch (e: any) {
      set({ lastError: e.message || "Login inválido" });
      return null;
    }
  },


  logout: () => {
    void api.logout().catch(() => null);
    gravarAuth(null);
    set({ auth: null });
  },
  toggleSom: () => set({ somLigado: !get().somLigado }),
  limparEventos: () => set({ eventos: [] }),
}));

/* ---------- seletores ---------- */
export const totalSessao = (pedidos: Pedido[], sessaoId: number) =>
  pedidos.filter((p) => p.sessaoId === sessaoId && p.status === "entregue").reduce((a, p) => a + p.total, 0);

/** Prefere valorTotal da API do caixa quando disponível */
export const consumoSessao = (sessao: Sessao, pedidos: Pedido[]) => {
  if (sessao.valorTotal != null && sessao.valorTotal >= 0) return sessao.valorTotal;
  return totalSessao(pedidos, sessao.id);
};

export const pagoSessao = (s: Sessao) => s.pagamentos.reduce((a, p) => a + p.valor, 0);

export const sessaoDaMesa = (sessoes: Sessao[], mesaId: number) => sessaoAberta(sessoes, mesaId);

export const FORMAS: { id: FormaPagamento; label: string }[] = [
  { id: "pix", label: "PIX" },
  { id: "dinheiro", label: "Dinheiro" },
  { id: "credito", label: "Crédito" },
  { id: "debito", label: "Débito" },
];

export function faturamentoSemana(sessoes: Sessao[]): { dia: string; valor: number }[] {
  const base = [0, 0, 0, 0, 0, 0, 0];
  const hoje = sessoes.filter((s) => s.status === "fechada").reduce((a, s) => a + pagoSessao(s), 0);
  const abertas = sessoes.filter((s) => s.status === "aberta").reduce((a, s) => a + pagoSessao(s), 0);
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Hoje"];
  return base.map((v, i) => ({ dia: dias[i], valor: i === 6 ? hoje + abertas : v }));
}

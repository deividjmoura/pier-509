import { AnimatePresence, motion } from "framer-motion";
import {
  Anchor,
  Check,
  ChevronRight,
  ClipboardList,
  Flame,
  HandPlatter,
  Minus,
  PartyPopper,
  Plus,
  Receipt,
  Search,
  Pencil,
  ShoppingBag,
  Timer,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Btn, FundoPirata, Input, Logo, Modal, Qtd, RodapeCliente, Selo, ThemeToggle } from "../components/ui";
import { confirmar } from "../components/Dialogos";
import type { Opcao, Pedido, Produto } from "../lib/types";
import { usePub, sessaoDaMesa, totalSessao } from "../store/usePub";
import { FOTO_PLACEHOLDER, fotoSrc } from "../lib/mappers";
import { descricaoExibida, isDoseProduto } from "../lib/descricao";
import { connectEvents } from "../lib/api";
import { BRL } from "../lib/utils";
import { cn } from "../utils/cn";
import { MARCA } from "../lib/marca";

/* ---------- item do carrinho ---------- */
interface CartItem {
  uid: string;
  produto: Produto;
  qtd: number;
  adicionais: Opcao[];
  removidos: string[];
  escolha: Opcao | null;
  obs: string;
}
const totalItem = (c: CartItem) =>
  (c.produto.preco + c.adicionais.reduce((a, b) => a + b.preco, 0) + (c.escolha?.preco ?? 0)) * c.qtd;

const STATUS_ORDEM: { id: Pedido["status"]; label: string }[] = [
  { id: "na_fila", label: "Recebido" },
  { id: "em_producao", label: "Na chapa" },
  { id: "pronto", label: "Pronto" },
  { id: "entregue", label: "Na mesa" },
];

export default function Mesa({ token }: { token: string }) {
  const mesas = usePub((s) => s.mesas);
  const produtos = usePub((s) => s.produtos);
  const sessoes = usePub((s) => s.sessoes);
  const pedidos = usePub((s) => s.pedidos);
  const criarPedido = usePub((s) => s.criarPedido);
  const cancelarPedido = usePub((s) => s.cancelarPedido);
  const categoriasStore = usePub((s) => s.categorias);
  const hydrateMesaToken = usePub((s) => s.hydrateMesaToken);
  const loading = usePub((s) => s.loading);
  const lastError = usePub((s) => s.lastError);
  const [boot, setBoot] = useState(true);

  useEffect(() => {
    if (!token) {
      setBoot(false);
      return;
    }
    let alive = true;
    setBoot(true);
    /* .finally() repassa a rejeição para a promessa resultante: sem o catch
       abaixo, uma queda de rede virava "Uncaught (in promise)" no console. */
    void hydrateMesaToken(token)
      .catch(() => null)
      .finally(() => {
        if (alive) setBoot(false);
      });
    /* poll + SSE: status da conta acompanha cozinha/garçom sem atraso longo */
    const t = setInterval(() => void hydrateMesaToken(token).catch(() => null), 8000);
    const off = connectEvents(() => {
      void hydrateMesaToken(token).catch(() => null);
    }, { mesa: token });
    return () => {
      alive = false;
      clearInterval(t);
      off();
    };
  }, [token, hydrateMesaToken]);

  const mesa = mesas.find((m) => m.token === token);

  const [categoria, setCategoria] = useState("Tudo");
  const [busca, setBusca] = useState("");
  const [catsHidden, setCatsHidden] = useState(false);
  const listaTopRef = useRef<HTMLDivElement>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [produtoModal, setProdutoModal] = useState<Produto | null>(null);
  const [sheet, setSheet] = useState<"cart" | "conta" | null>(null);
  const [nome, setNome] = useState(() => {
    try {
      return sessionStorage.getItem(`pier509-nome-${token}`) || "";
    } catch {
      return "";
    }
  });
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(`pier509-nome-${token}`, nome);
    } catch {
      /* sem armazenamento: o nome vale só para esta visita */
    }
  }, [nome, token]);

  /* categorias somem no scroll — só o search fica sticky */
  useEffect(() => {
    const onScroll = () => {
      setCatsHidden(window.scrollY > 56);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const irParaLista = () => {
    requestAnimationFrame(() => {
      listaTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const sessao = mesa ? sessaoDaMesa(sessoes, mesa.id) : undefined;
  const pedidosMesa = sessao ? pedidos.filter((p) => p.sessaoId === sessao.id).sort((a, b) => b.criadoEm - a.criadoEm) : [];
  const totalConta = sessao ? totalSessao(pedidos, sessao.id) : 0;
  const totalCart = cart.reduce((a, c) => a + totalItem(c), 0);
  const qtdCart = cart.reduce((a, c) => a + c.qtd, 0);

  const categorias = useMemo(() => {
    const ordered = [...categoriasStore].sort((a, b) => a.ordem - b.ordem).map((c) => c.nome);
    const presentes = new Set(produtos.filter((p) => p.ativo).map((p) => p.categoria));
    const list = ordered.filter((n) => presentes.has(n));
    for (const n of presentes) if (!list.includes(n)) list.push(n);
    return ["Tudo", ...(list.length ? list : [])];
  }, [produtos, categoriasStore]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const ordemCat = new Map(
      [...categoriasStore].sort((a, b) => a.ordem - b.ordem).map((c, i) => [c.nome, c.ordem ?? i])
    );
    const filtrados = produtos.filter((p) => {
      if (!p.ativo) return false;
      if (b) return p.nome.toLowerCase().includes(b) || p.descricao.toLowerCase().includes(b);
      if (categoria === "Tudo") return true;
      return p.categoria === categoria;
    });
    return filtrados.sort((a, b) => {
      const ca = ordemCat.get(a.categoria) ?? a.categoriaOrdem ?? 999;
      const cb = ordemCat.get(b.categoria) ?? b.categoriaOrdem ?? 999;
      if (ca !== cb) return ca - cb;
      const oa = a.ordem ?? a.id;
      const ob = b.ordem ?? b.id;
      if (oa !== ob) return oa - ob;
      return a.id - b.id;
    });
  }, [produtos, categoria, busca, categoriasStore]);

  /** Em "Tudo" (sem busca): produtos agrupados por categoria na ordem do admin */
  const gruposCardapio = useMemo(() => {
    if (busca.trim() || categoria !== "Tudo") return null;
    const ordem = new Map(
      [...categoriasStore].sort((a, b) => a.ordem - b.ordem).map((c, i) => [c.nome, c.ordem ?? i])
    );
    const map = new Map<string, typeof lista>();
    for (const p of lista) {
      const k = p.categoria || "Outros";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return [...map.entries()]
      .sort((a, b) => (ordem.get(a[0]) ?? 999) - (ordem.get(b[0]) ?? 999))
      .map(([nome, itens]) => ({ nome, itens }));
  }, [lista, categoria, busca, categoriasStore]);


    if (boot || (loading && !mesa)) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-center">
        <div className="flex flex-col items-center">
          <Selo tamanho={86} className="animate-pulse" />
          <h1 className="font-display text-4xl text-navy-900 mt-6">Carregando a mesa…</h1>
          <p className="text-slate-500 mt-2 text-sm">Conferindo o QR no convés.</p>
        </div>
      </div>
    );
  }

  if (!mesa) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-center">
        <div className="flex flex-col items-center">
          <Selo tamanho={92} />
          <h1 className="font-display text-5xl text-navy-900 mt-6">QR inválido</h1>
          <p className="text-slate-500 mt-2 text-sm">
            {lastError || `Este QR Code não pertence a nenhuma mesa do ${MARCA.nome}.`}
          </p>
          <p className="text-slate-400 mt-3 text-xs font-mono break-all max-w-sm mx-auto">
            token: {token || "(vazio)"}
          </p>
          <p className="text-slate-500 mt-3 text-xs max-w-sm mx-auto">
            Use o QR Code da mesa (link com o token cadastrado no sistema).
          </p>
          <p className="mt-8 text-xs text-slate-500">Peça o QR Code impresso na mesa ao estabelecimento.</p>
        </div>
      </div>
    );
  }

  const addCart = (item: CartItem) => setCart((c) => [...c, item]);

  const enviar = () => {
    if (!cart.length) return;
    const itens = cart.map((c) => ({
      id: c.uid,
      produtoId: c.produto.id,
      nome: c.produto.nome,
      qtd: c.qtd,
      precoBase: c.produto.preco,
      adicionais: c.adicionais,
      removidos: c.removidos,
      escolha: c.escolha,
      obs: c.obs,
      totalUnit: totalItem(c) / c.qtd,
    }));
    const id = criarPedido(mesa.id, nome, itens);
    if (id) {
      setCart([]);
      setSheet(null);
      setEnviado(true);
      setTimeout(() => {
        setEnviado(false);
        setSheet("conta");
      }, 2100);
    }
  };


  /* ==================== painéis reutilizáveis ==================== */

  const painelCarrinho = (
    <div className="flex h-full flex-col">
      <h3 className="font-display text-3xl text-navy-900 flex items-center gap-2">
        <ShoppingBag className="size-6 text-brand-600" /> Seu pedido
      </h3>
      {cart.length === 0 ? (
        <div className="flex-1 grid place-items-center py-14 text-center">
          <div>
            <UtensilsCrossed className="size-10 text-slate-400 mx-auto" />
            <p className="mt-3 text-sm text-slate-500">Carrinho vazio por aqui…<br />Bateu aquela fome?</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto pr-1 no-scrollbar">
            <AnimatePresence initial={false}>
              {cart.map((c) => (
                <motion.div
                  key={c.uid}
                  layout
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
                  className="flex gap-3 rounded-2xl bg-slate-100/60 border border-slate-200 p-3"
                >
                  <img src={fotoSrc(c.produto.foto) || FOTO_PLACEHOLDER} alt="" className="size-14 rounded-xl object-cover" onError={(e) => { (e.target as HTMLImageElement).src = FOTO_PLACEHOLDER; }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-navy-900 leading-tight">{c.produto.nome}</p>
                      <button onClick={() => setCart((x) => x.filter((y) => y.uid !== c.uid))} className="text-slate-500 hover:text-rose-700 cursor-pointer shrink-0">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 leading-snug">
                      {c.escolha && <span className="text-navy-700">{c.escolha.nome} · </span>}
                      {c.adicionais.map((a) => `+${a.nome}`).join(", ")}
                      {c.removidos.length > 0 && <span className="text-rose-600"> · sem {c.removidos.join(", ")}</span>}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <Qtd size="sm" valor={c.qtd} onChange={(v) => setCart((x) => x.map((y) => (y.uid === c.uid ? { ...y, qtd: v } : y)))} />
                      <span className="font-mono text-sm font-semibold text-brand-600">{BRL(totalItem(c))}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-200 space-y-3">
            <Input value={nome} onChange={setNome} placeholder="Seu nome (p/ a cozinha chamar)" />
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-slate-500 font-bold">total do pedido</span>
              <span className="font-display text-4xl text-gradient">{BRL(totalCart)}</span>
            </div>
            <Btn full size="lg" onClick={enviar} disabled={!cart.length}>
              Enviar pra cozinha <ChevronRight className="size-4.5" />
            </Btn>
          </div>
        </>
      )}
    </div>
  );

  const painelConta = (
    <div className="flex h-full flex-col">
      <h3 className="font-display text-3xl text-navy-900 flex items-center gap-2">
        <Receipt className="size-6 text-brand-600" /> Sua conta
      </h3>

      {pedidosMesa.length === 0 ? (
        <div className="flex-1 grid place-items-center py-14 text-center">
          <div>
            <Timer className="size-10 text-slate-400 mx-auto" />
            <p className="mt-3 text-sm text-slate-500">Nenhum pedido ainda nesta visita.<br />Faça o primeiro!</p>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1 no-scrollbar">
          {pedidosMesa.map((p) => {
            const stepIdx = STATUS_ORDEM.findIndex((s) => s.id === p.status);
            return (
              <div key={p.id} className="rounded-2xl bg-slate-100/60 border border-slate-200 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-500">
                    Pedido <span className="font-mono text-navy-900">#{p.id}</span> · {p.clienteNome}
                  </p>
                  <Badge tone={p.status === "entregue" ? "lime" : p.status === "pronto" ? "sky" : p.status === "em_producao" ? "amber" : "zinc"} pulse={p.status !== "entregue"}>
                    {STATUS_ORDEM[stepIdx].label}
                  </Badge>
                </div>

                {/* linha de progresso */}
                <div className="mt-3 flex items-center gap-1">
                  {STATUS_ORDEM.map((s, i) => (
                    <div key={s.id} className="flex-1">
                      <div className={cn("h-1.5 rounded-full transition-colors duration-500", i <= stepIdx ? "bg-gradient-to-r from-brand-500 to-teal-600" : "bg-slate-100")} />
                    </div>
                  ))}
                </div>

                <ul className="mt-3 space-y-1">
                  {p.itens.map((i) => (
                    <li key={i.id} className="flex justify-between gap-3 text-[13px] text-slate-600">
                      <span className="leading-snug">
                        <b className="text-navy-900 font-mono">{i.qtd}×</b> {i.nome}
                        {i.status && (
                          <span className={
                            "ml-1.5 text-[9px] font-bold uppercase tracking-wider " +
                            (i.status === "entregue"
                              ? "text-teal-600"
                              : i.status === "concluido"
                                ? "text-teal-700"
                                : i.status === "em_producao"
                                  ? "text-navy-700"
                                  : "text-amber-700")
                          }>
                            {i.status === "recebido"
                              ? "na fila"
                              : i.status === "em_producao"
                                ? "preparando"
                                : i.status === "concluido"
                                  ? "pronto"
                                  : i.status === "entregue"
                                    ? "entregue"
                                    : i.status}
                          </span>
                        )}
                        <span className="block text-[11px] text-slate-500">
                          {[i.escolha?.nome, ...i.adicionais.map((a) => `+${a.nome}`), i.removidos.length ? `sem ${i.removidos.join(", ")}` : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="font-mono text-slate-500">{BRL(i.totalUnit * i.qtd)}</span>
                    </li>
                  ))}
                </ul>

                {p.status === "na_fila" && (
                  <div className="mt-3 flex gap-2">
                    <Btn
                      size="sm"
                      variant="ghost"
                      className="flex-1"
                      onClick={() => {
                        // carrega itens no carrinho e remove o pedido antigo ao reenviar
                        const items: CartItem[] = p.itens.map((i) => {
                          const prod = produtos.find((x) => x.id === i.produtoId) || {
                            id: i.produtoId,
                            nome: i.nome,
                            descricao: "",
                            preco: i.precoBase,
                            categoria: "",
                            foto: "",
                            tipo: "simples" as const,
                            adicionais: [],
                            removiveis: [],
                            ativo: true,
                            estoque: null,
                            vendidos: 0,
                          };
                          return {
                            uid: Math.random().toString(36).slice(2),
                            produto: prod,
                            qtd: i.qtd,
                            adicionais: i.adicionais,
                            removidos: i.removidos,
                            escolha: i.escolha,
                            obs: i.obs,
                          };
                        });
                        cancelarPedido(p.id);
                        setCart(items);
                        setSheet("cart");
                      }}
                    >
                      <Pencil className="size-3.5" /> Editar
                    </Btn>
                    <Btn
                      size="sm"
                      variant="danger"
                      className="flex-1"
                      onClick={() => {
                        void confirmar(
                          `Cancelar o pedido #${p.id}? Só dá enquanto a cozinha ainda não começou o preparo.`
                        ).then((ok) => {
                          if (ok) cancelarPedido(p.id);
                        });
                      }}
                    >
                      <Trash2 className="size-3.5" /> Cancelar
                    </Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* total da visita — pagamento só no caixa / garçom (igual main) */}
      <div className="pt-4 mt-4 border-t border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-widest text-slate-500 font-bold">total da visita</span>
          <span className="font-display text-4xl text-gradient">{BRL(totalConta)}</span>
        </div>
        <p className="text-xs text-slate-500 text-center">Pagamento no caixa ou com o garçom.</p>
      </div>
    </div>
  );

  /* ==================== render ==================== */
  return (
    <div className="relative min-h-dvh pb-[calc(8rem+env(safe-area-inset-bottom,0px))] lg:pb-12 overflow-x-clip">
      {/* fundo: doodles piratas (mesa do cliente) */}
      <FundoPirata variante="cliente" />

      {/* header — tabuada de madeira */}
      <header className="sticky top-0 z-50 border-b-2 border-brand-700/40 placa-madeira">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 h-16 sm:h-18 flex items-center gap-2 sm:gap-3 min-w-0">
          <Logo size="sm" />
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-[#f6e3bb]/35 bg-black/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#f6dd9c]">
            <Anchor className="size-3" /> {mesa.nome}
          </span>
          {sessao && sessao.pixAvisos > 0 && <Badge tone="lime">pix {sessao.pixAvisos}×</Badge>}
          <div className="flex-1" />
          <ThemeToggle className="border-[#f6e3bb]/25 bg-black/25 text-[#f6e3bb] hover:text-white" />
          <button
            onClick={() => setSheet("conta")}
            className="btn-press lg:hidden flex items-center gap-2 rounded-full bg-black/25 border border-[#f6e3bb]/25 h-10 pl-3.5 pr-4 text-xs font-bold text-[#f6e3bb] cursor-pointer"
          >
            <Receipt className="size-4 text-brand-600" />
            <span className="tabular">{BRL(totalConta)}</span>
          </button>
          <button
            onClick={() => setSheet("cart")}
            className="btn-press relative grid place-items-center size-10 rounded-full border border-brand-700/40 bg-gradient-to-br from-brand-400 to-brand-600 text-[#2a1f08] cursor-pointer"
          >
            <ShoppingBag className="size-4.5" />
            <AnimatePresence>
              {qtdCart > 0 && (
                <motion.span
                  key={qtdCart}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1.5 -right-1.5 grid place-items-center min-w-5 h-5 px-1 rounded-full bg-teal-500 text-[#04241c] text-[10px] font-bold border-2 border-[#f6e3bb]"
                >
                  {qtdCart}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          {/* -------- coluna cardápio -------- */}
          <section className="lg:col-span-8 xl:col-span-8">
            {/* hero da mesa */}
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="pt-8 sm:pt-10 pb-6">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-600">
                <HandPlatter className="size-4" /> bem-vindo(a) à {mesa.nome}
              </p>
              <h1 className="font-display text-[clamp(2.75rem,12vw,6rem)] sm:text-7xl lg:text-8xl leading-[0.9] text-navy-900 mt-2">
                Bateu a fome?<br /><span className="text-ouro">Pede sem esperar.</span>
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="lime" pulse>cozinha recebendo</Badge>
                <Badge tone="zinc">peça quantas vezes quiser</Badge>
                <Badge tone="zinc">tudo entra na mesma conta</Badge>
              </div>
            </motion.div>

            {/* categorias — somem ao scroll */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-300 ease-out",
                catsHidden ? "max-h-0 opacity-0 mb-0 pointer-events-none" : "max-h-24 opacity-100 mb-2"
              )}
            >
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
                {categorias.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCategoria(c);
                      setBusca("");
                      irParaLista();
                    }}
                    className={cn(
                      "btn-press relative shrink-0 h-10 px-4.5 rounded-full text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors border",
                      categoria === c && !busca
                        ? "text-white border-transparent"
                        : "text-slate-500 border-slate-200 hover:text-navy-800 bg-slate-100/50"
                    )}
                  >
                    {categoria === c && !busca && (
                      <motion.span
                        layoutId="cat-pill"
                        className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-500 to-teal-600"
                        transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      />
                    )}
                    <span className="relative z-10">{c}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* search sticky — limpo, sem fundo pesado */}
            <div className="sticky top-14 sm:top-16 z-40 py-2">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-500 pointer-events-none" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar no cardápio…"
                  className="w-full h-11 rounded-full bg-transparent border border-slate-300 pl-11 pr-10 text-sm text-navy-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500/60 transition"
                />
                {busca && (
                  <button
                    type="button"
                    onClick={() => setBusca("")}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-navy-800 cursor-pointer"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>

            {/* âncora: itens começam logo abaixo do search (scroll-margin do sticky) */}
            <div ref={listaTopRef} className="scroll-mt-[7.25rem] sm:scroll-mt-[7.75rem]" />

            {/* título da seção */}
            <div className="mt-3 mb-3 flex items-center gap-2 min-w-0">
              <Flame className="size-4 text-brand-600 shrink-0" />
              <h2 className="font-display text-2xl sm:text-3xl text-navy-900 truncate">
                {busca
                  ? `Resultados p/ “${busca}”`
                  : categoria === "Tudo"
                    ? "Cardápio"
                    : categoria}
              </h2>
              <span className="text-xs font-mono text-slate-500 shrink-0">{lista.length} itens</span>
            </div>

            {gruposCardapio ? (
              <div className="space-y-8 pb-28 lg:pb-10 w-full min-w-0">
                {gruposCardapio.map((g) => (
                  <section key={g.nome}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="h-px flex-1 bg-gradient-to-r from-brand-500/30 to-transparent" />
                      <h3 className="font-display text-xl sm:text-2xl text-brand-700 tracking-wide">{g.nome}</h3>
                      <span className="h-px flex-1 bg-gradient-to-l from-brand-500/30 to-transparent" />
                    </div>
                    <motion.div layout className="grid-cardapio grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3.5 w-full min-w-0">
                      <AnimatePresence mode="popLayout">
                        {g.itens.map((p) => (
                          <ItemCard
                            key={p.id}
                            produto={p}
                            onOpen={setProdutoModal}
                            onAdd={(prod) =>
                              addCart({ uid: Math.random().toString(36).slice(2), produto: prod, qtd: 1, adicionais: [], removidos: [], escolha: null, obs: "" })
                            }
                          />
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  </section>
                ))}
              </div>
            ) : (
              <motion.div layout className="grid-cardapio grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3.5 pb-28 lg:pb-10 w-full min-w-0">
                <AnimatePresence mode="popLayout">
                  {lista.map((p) => (
                    <ItemCard
                      key={p.id}
                      produto={p}
                      onOpen={setProdutoModal}
                      onAdd={(prod) =>
                        addCart({ uid: Math.random().toString(36).slice(2), produto: prod, qtd: 1, adicionais: [], removidos: [], escolha: null, obs: "" })
                      }
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </section>

          {/* -------- coluna lateral (desktop) -------- */}
          <aside className="hidden lg:block lg:col-span-4 pt-10">
            <div className="sticky top-24 glass-deep noise rounded-3xl p-5 max-h-[calc(100dvh-8.5rem)] flex flex-col gap-0 overflow-hidden">
              <PainelComAbas
                cart={cart}
                totalConta={totalConta}
                painelCarrinho={painelCarrinho}
                painelConta={painelConta}
              />
            </div>
          </aside>
        </div>
      </div>

      <RodapeCliente className="lg:pb-0" />

      {/* -------- barra inferior (mobile) -------- */}
      <AnimatePresence>
        {(qtdCart > 0 || pedidosMesa.length > 0) && (
          <motion.div
            initial={{ y: 90 }}
            animate={{ y: 0 }}
            exit={{ y: 90 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="lg:hidden fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-slate-50 via-white/90 to-transparent"
          >
            <div className="flex gap-2.5 max-w-md mx-auto">
              <button
                onClick={() => setSheet("conta")}
                className="btn-press flex-1 h-13 rounded-2xl glass-deep flex items-center justify-center gap-2 cursor-pointer"
              >
                <Receipt className="size-4.5 text-brand-600" />
                <span className="text-sm font-bold text-navy-900 tabular">{BRL(totalConta)}</span>
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">conta</span>
              </button>
              <button
                onClick={() => setSheet("cart")}
                className="btn-press flex-[1.3] h-13 rounded-2xl bg-gradient-to-br from-brand-500 to-teal-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-[0_14px_38px_-8px_rgba(0,196,180,0.55)] cursor-pointer"
              >
                <ShoppingBag className="size-4.5" />
                {qtdCart === 0 ? "Pedir" : `Pedir · ${BRL(totalCart)}`}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -------- sheets mobile -------- */}
      <Modal open={sheet === "cart"} onClose={() => setSheet(null)}>
        <div className="p-5 sm:p-6 min-h-[55dvh]">{painelCarrinho}</div>
      </Modal>
      <Modal open={sheet === "conta"} onClose={() => setSheet(null)}>
        <div className="p-5 sm:p-6 min-h-[55dvh]">{painelConta}</div>
      </Modal>

      {/* -------- modal produto -------- */}
      <ProdutoModal
        produto={produtoModal}
        onClose={() => setProdutoModal(null)}
        onAdd={(item) => {
          addCart(item);
        }}
      />

      {/* -------- celebração enviado -------- */}
      <AnimatePresence>
        {enviado && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-95 grid place-items-center bg-white/85 backdrop-blur-md p-6"
          >
            <motion.div
              initial={{ scale: 0.7, y: 40 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              className="text-center"
            >
              <motion.div
                animate={{ rotate: [0, -8, 8, 0] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                className="mx-auto grid place-items-center size-24 rounded-3xl bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-[0_20px_60px_-10px_rgba(20,184,166,0.5)]"
              >
                <PartyPopper className="size-11" />
              </motion.div>
              <h2 className="font-display text-6xl text-navy-900 mt-6">PEDIDO ENVIADO!</h2>
              <p className="mt-2 text-slate-600 flex items-center justify-center gap-2 text-sm">
                <Check className="size-4 text-teal-600" /> Já está na fila da cozinha — acompanhe na sua conta
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- painel com abas (desktop) ---------- */
/**
 * Card de item do cardápio — usada tanto na visão agrupada ("Tudo")
 * quanto na visão filtrada/busca. Extraída para evitar duplicação de JSX
 * (a causa raiz de cards com aparência divergente entre as duas listagens).
 */
function ItemCard({
  produto: p,
  onOpen,
  onAdd,
}: {
  produto: Produto;
  onOpen: (p: Produto) => void;
  onAdd: (p: Produto) => void;
}) {
  const esgotado = p.estoque !== null && p.estoque <= 0;
  const meta =
    p.tipo === "escolher"
      ? "1 opção"
      : p.tipo === "personalizavel"
        ? `${p.adicionais.length} extra${p.adicionais.length === 1 ? "" : "s"}`
        : "pronto";
  const ctaLabel =
    p.tipo === "escolher" ? "Escolher" : p.tipo === "personalizavel" ? "Montar" : "Add";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "card-produto card-img-zoom group relative flex h-full min-h-0 flex-col glass rounded-3xl overflow-hidden",
        esgotado && "opacity-55 grayscale-[0.55]"
      )}
    >
      {/* Foto — altura fixa por aspect-ratio, nunca empurra o texto */}
      <button
        type="button"
        onClick={() => onOpen(p)}
        className="relative block w-full shrink-0 aspect-[4/3] overflow-hidden cursor-pointer text-left bg-slate-100"
        aria-label={`Ver ${p.nome}`}
      >
        <img
          src={fotoSrc(p.foto) || FOTO_PLACEHOLDER}
          alt=""
          loading="lazy"
          decoding="async"
          className="card-produto-foto transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            (e.target as HTMLImageElement).src = FOTO_PLACEHOLDER;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-50/95 via-slate-50/20 to-transparent pointer-events-none" />
        <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1 pointer-events-none z-[1]">
          {p.estoque !== null && p.estoque > 0 && p.estoque <= 8 && (
            <Badge tone="rose" pulse>
              {p.estoque} un
            </Badge>
          )}
          {esgotado && <Badge tone="zinc">esgotado</Badge>}
        </div>
        <span className="absolute bottom-2 left-2 z-[1] rounded-lg bg-white/85 backdrop-blur-sm px-2 py-0.5 font-mono text-xs sm:text-sm font-bold text-navy-900 tabular-nums pointer-events-none">
          {BRL(p.preco)}
        </span>
      </button>

      {/* Corpo — flex column com rodapé sempre no fundo */}
      <div className="flex flex-1 flex-col min-h-0 p-2.5 sm:p-3.5 gap-1.5">
        <button
          type="button"
          onClick={() => onOpen(p)}
          className="text-left cursor-pointer min-w-0"
        >
          <h3 className="font-semibold text-navy-900 leading-snug text-[13px] sm:text-sm line-clamp-2 min-h-[2.5em] break-words">
            {p.nome}
          </h3>
          <p className="mt-0.5 text-[10px] sm:text-[11px] text-slate-500 leading-snug line-clamp-2 min-h-[2.4em] break-words">
            {descricaoExibida(p.descricao, p.nome, p.categoria) || "\u00a0"}
          </p>
        </button>

        <div className="mt-auto pt-1 flex flex-col gap-1.5 min-w-0">
          <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500 truncate">
            {meta}
          </span>
          {p.tipo === "simples" ? (
            <Btn
              size="sm"
              full
              disabled={esgotado}
              onClick={() => onAdd(p)}
              className="!h-9 !px-2 !text-[11px] sm:!text-xs shrink-0"
            >
              <Plus className="size-3.5 shrink-0" />
              <span className="truncate">Adicionar</span>
            </Btn>
          ) : (
            <Btn
              size="sm"
              variant="outline"
              full
              disabled={esgotado}
              onClick={() => onOpen(p)}
              className="!h-9 !px-2 !text-[11px] sm:!text-xs shrink-0"
            >
              <span className="truncate">{ctaLabel}</span>
              <ChevronRight className="size-3.5 shrink-0 opacity-80" />
            </Btn>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function PainelComAbas({
  cart,
  totalConta,
  painelCarrinho,
  painelConta,
}: {
  cart: CartItem[];
  totalConta: number;
  painelCarrinho: React.ReactNode;
  painelConta: React.ReactNode;
}) {
  const [aba, setAba] = useState<"cart" | "conta">("cart");
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 border border-slate-200 p-1 mb-5">
        {([
          { id: "cart", label: "Seu pedido", icon: ShoppingBag },
          { id: "conta", label: `Conta · ${BRL(totalConta)}`, icon: ClipboardList },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setAba(t.id)}
            className={cn(
              "relative h-10 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors",
              aba === t.id ? "text-white" : "text-slate-500 hover:text-navy-800"
            )}
          >
            {aba === t.id && (
              <motion.span layoutId="painel-aba" className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand-500 to-teal-600" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <t.icon className="size-3.5" /> {t.label}
              {t.id === "cart" && cart.length > 0 && <span className="grid place-items-center min-w-4.5 h-4.5 px-1 rounded-full bg-slate-200/60 text-[10px] font-bold">{cart.length}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{aba === "cart" ? painelCarrinho : painelConta}</div>
    </div>
  );
}

/* ---------- modal do produto ---------- */
function ProdutoModal({
  produto,
  onClose,
  onAdd,
}: {
  produto: Produto | null;
  onClose: () => void;
  onAdd: (c: CartItem) => void;
}) {
  const [qtd, setQtd] = useState(1);
  const [ads, setAds] = useState<Opcao[]>([]);
  const [rems, setRems] = useState<string[]>([]);
  const [escolha, setEscolha] = useState<Opcao | null>(null);
  const [gelo, setGelo] = useState<"com" | "sem">("com");
  const [obs, setObs] = useState("");

  useEffect(() => {
    if (produto) {
      setQtd(1);
      setAds([]);
      setRems([]);
      setObs("");
      setEscolha(produto.tipo === "escolher" ? null : null);
      setGelo("com");
    }
  }, [produto]);

  if (!produto) return null;

  const dose = isDoseProduto(produto.nome, produto.categoria);
  const precisaEscolha = produto.tipo === "escolher";
  const unit =
    produto.preco + ads.reduce((a, b) => a + b.preco, 0) + (escolha?.preco ?? 0);
  const pode = !precisaEscolha || !!escolha;
  const desc = descricaoExibida(produto.descricao, produto.nome, produto.categoria);

  const confirmar = () => {
    if (!pode) return;
    const obsParts = [obs.trim()];
    if (dose) obsParts.unshift(gelo === "sem" ? "Sem gelo" : "Com gelo");
    onAdd({
      uid: Math.random().toString(36).slice(2),
      produto,
      qtd,
      adicionais: ads,
      removidos: rems,
      escolha,
      obs: obsParts.filter(Boolean).join(" · "),
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} wide closeOnBackdrop={false}>
      <div className="overflow-hidden">
        {/* imagem + título colados — sem gap */}
        <div className="relative w-full aspect-[16/11] sm:aspect-[16/10] bg-white">
          <img
            src={fotoSrc(produto.foto) || FOTO_PLACEHOLDER}
            alt={produto.nome}
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = FOTO_PLACEHOLDER;
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-50 via-slate-50/20 to-transparent pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 pointer-events-none">
            <Badge tone="amber">{produto.categoria}</Badge>
            <h3 className="font-display text-3xl sm:text-4xl text-navy-900 leading-none mt-2 drop-shadow-lg break-words">
              {produto.nome}
            </h3>
            <p className="mt-1.5 font-mono text-lg font-bold text-brand-600 drop-shadow">{BRL(produto.preco)}</p>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>

          {/* doses: com / sem gelo */}
          {dose && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-navy-700 mb-2.5">gelo</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "com" as const, label: "Com gelo" },
                    { id: "sem" as const, label: "Sem gelo" },
                  ] as const
                ).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGelo(g.id)}
                    className={cn(
                      "btn-press inline-flex items-center gap-1.5 rounded-full border px-3.5 h-10 text-xs font-semibold cursor-pointer transition-all",
                      gelo === g.id
                        ? "border-navy-700/50 bg-navy-700/10 text-navy-700"
                        : "border-slate-200 bg-slate-100/50 text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {gelo === g.id ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                    {g.label}
                    <span className="font-mono opacity-70">+{BRL(0)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {precisaEscolha && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-navy-700 mb-2.5">escolha uma opção</p>
              <div className="space-y-2">
                {produto.adicionais.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setEscolha(a)}
                    className={cn(
                      "btn-press w-full flex items-center gap-3 rounded-2xl border p-3.5 text-left cursor-pointer transition-all",
                      escolha?.id === a.id
                        ? "border-brand-500/60 bg-brand-500/10"
                        : "border-slate-200 bg-slate-100/50 hover:border-slate-300"
                    )}
                  >
                    <span
                      className={cn(
                        "grid place-items-center size-5 rounded-full border-2 shrink-0",
                        escolha?.id === a.id ? "border-brand-400" : "border-slate-300"
                      )}
                    >
                      {escolha?.id === a.id && <span className="size-2.5 rounded-full bg-brand-400" />}
                    </span>
                    <span className="flex-1 text-sm font-semibold text-navy-900">{a.nome}</span>
                    <span className="font-mono text-xs text-slate-500">
                      {a.preco > 0 ? `+ ${BRL(a.preco)}` : "incluso"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!precisaEscolha && produto.adicionais.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-600 mb-2.5">adições</p>
              <div className="flex flex-wrap gap-2">
                {produto.adicionais.map((a) => {
                  const on = ads.some((x) => x.id === a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAds((x) => (on ? x.filter((y) => y.id !== a.id) : [...x, a]))}
                      className={cn(
                        "btn-press inline-flex items-center gap-1.5 rounded-full border px-3.5 h-10 text-xs font-semibold cursor-pointer transition-all",
                        on
                          ? "border-brand-500/60 bg-brand-500/10 text-brand-700"
                          : "border-slate-200 bg-slate-100/50 text-slate-600 hover:border-slate-300"
                      )}
                    >
                      {on ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                      {a.nome}
                      <span className="font-mono opacity-70">+{BRL(a.preco)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {produto.removiveis.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-rose-600 mb-2.5">tirar do jeito que vem</p>
              <div className="flex flex-wrap gap-2">
                {produto.removiveis.map((r) => {
                  const on = rems.includes(r.nome);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRems((x) => (on ? x.filter((y) => y !== r.nome) : [...x, r.nome]))}
                      className={cn(
                        "btn-press inline-flex items-center gap-1.5 rounded-full border px-3.5 h-9 text-xs font-semibold cursor-pointer transition-all",
                        on
                          ? "border-rose-500/60 bg-rose-600/10 text-rose-700"
                          : "border-slate-200 bg-slate-100/50 text-slate-500 hover:border-slate-300"
                      )}
                    >
                      <Minus className="size-3" /> sem {r.nome.toLowerCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Input value={obs} onChange={setObs} placeholder="Observação p/ cozinha (opcional)" />

          <div className="flex items-center justify-between gap-4 pt-1">
            <Qtd valor={qtd} onChange={setQtd} />
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">subtotal</p>
              <p className="font-display text-4xl text-gradient leading-none">{BRL(unit * qtd)}</p>
            </div>
          </div>

          <Btn full size="lg" onClick={confirmar} disabled={!pode}>
            {pode ? <>Adicionar ao pedido · {BRL(unit * qtd)}</> : "Escolha uma opção pra continuar"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

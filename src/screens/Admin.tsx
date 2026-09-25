import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown, ArrowUp, Boxes, ChevronDown, ChevronRight, Camera, ChartNoAxesColumn, CircleAlert, Copy, Download, Eye, EyeOff,
  FileText, LayoutGrid, Link2, Pencil, Plus, Printer, QrCode, Receipt, Trash2,
  TrendingUp, Trophy, UserPlus, Users, UtensilsCrossed,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OpsShell } from "../components/OpsShell";
import { useGuarda } from "../lib/guarda";
import { avisar, confirmar } from "../components/Dialogos";
import { Carregando, Badge, Btn, Input, Modal } from "../components/ui";
import { ir } from "../router";
import { api } from "../lib/api";
import { descricaoPadrao } from "../lib/descricao";
import { imprimirComandaHistorico, imprimirRelatorioPdf } from "../lib/print";
import type { ItemPedido, Pedido } from "../lib/types";
import { CATEGORIAS } from "../lib/data";
import type { Produto, TipoProduto } from "../lib/types";
import { faturamentoSemana, totalSessao, usePub } from "../store/usePub";
import { BRL } from "../lib/utils";
import { cn } from "../utils/cn";

const ABAS = [
  { id: "painel", label: "Dashboard", icon: ChartNoAxesColumn },
  { id: "cardapio", label: "Cardápio", icon: UtensilsCrossed },
  { id: "mesas", label: "Mesas", icon: QrCode },
  { id: "garcons", label: "Garçons", icon: Users },
  { id: "funcoes", label: "Funções", icon: LayoutGrid },
] as const;

type AbaId = (typeof ABAS)[number]["id"];

/** YYYY-MM-DD no fuso local (evita toISOString puxar dia anterior em -03) */
function dataLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


export default function Admin() {
  const { checando } = useGuarda(["admin"]);
  const hydrateCardapio = usePub((s) => s.hydrateCardapio);
  const hydrateMesas = usePub((s) => s.hydrateMesas);
  useEffect(() => {
    void hydrateCardapio();
    void hydrateMesas();
  }, [hydrateCardapio, hydrateMesas]);

  const [aba, setAba] = useState<AbaId>("painel");

  const extras = (
    <nav className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100 border border-slate-200 p-1">
      {ABAS.map((a) => (
        <button
          key={a.id}
          onClick={() => setAba(a.id)}
          className={cn(
            "btn-press relative flex items-center gap-1.5 rounded-xl px-3 h-9 text-xs font-bold cursor-pointer transition-colors",
            aba === a.id ? "text-white" : "text-slate-500 hover:text-navy-800"
          )}
        >
          {aba === a.id && (
            <motion.span layoutId="adm-aba" className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand-500 to-teal-600" transition={{ type: "spring", stiffness: 420, damping: 32 }} />
          )}
          <a.icon className="relative z-10 size-3.5" />
          <span className="relative z-10 hidden sm:inline">{a.label}</span>
        </button>
      ))}
    </nav>
  );

  if (checando) return <Carregando />;

  return (
    <OpsShell
      ativo="admin"
      fundo="admin"
      kicker="comando · admin"
      titulo={<>Comando <span className="text-ouro">do Pier</span></>}
      extra={extras}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={aba}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {aba === "painel" && <Painel />}
          {aba === "cardapio" && <Cardapio />}
          {aba === "mesas" && <Mesas />}
          {aba === "garcons" && <Garcons />}
          {aba === "funcoes" && <Funcoes />}
        </motion.div>
      </AnimatePresence>
    </OpsShell>
  );
}

/* ================= DASHBOARD ================= */
function Painel() {
  const sessoes = usePub((s) => s.sessoes);
  const pedidos = usePub((s) => s.pedidos);
  const produtos = usePub((s) => s.produtos);

  const [dash, setDash] = useState<any>(null);
  const [loadingDash, setLoadingDash] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .adminDashboard()
        .then((d) => {
          if (alive) {
            setDash(d);
            setLoadingDash(false);
          }
        })
        .catch(() => {
          if (alive) setLoadingDash(false);
        });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Fonte oficial: API /api/admin/dashboard (sessões fechadas de HOJE no banco)
  const fatHoje = Number(dash?.faturamento ?? 0);
  const qtdPedidos = Number(dash?.pedidosTotal ?? 0);
  const ticketApi = Number(dash?.ticketMedio ?? 0);
  // Consumo em aberto: soma valor_total das sessões abertas (já entregue)
  const emAberto =
    Number(dash?.emAberto?.valorEntregue ?? 0) ||
    sessoes
      .filter((s) => s.status === "aberta")
      .reduce((a, s) => a + (s.valorTotal != null ? Number(s.valorTotal) : totalSessao(pedidos, s.id)), 0);

  // Ticket médio oficial = faturamento / contas fechadas (não por pedido)
  const ticket = ticketApi > 0 ? ticketApi : qtdPedidos ? fatHoje / Math.max(1, Number(dash?.contasFechadas || 1)) : 0;

  // Campeões: preferir top da API; fallback para produtos.vendidos (quase sempre 0)
  const topApi: { nome: string; quantidade: number; receita?: number }[] = Array.isArray(dash?.topProdutos)
    ? dash.topProdutos
    : [];
  const top =
    topApi.length > 0
      ? topApi.slice(0, 5).map((t, i) => {
          const prod = produtos.find((p) => p.nome === t.nome);
          return {
            id: prod?.id ?? i,
            nome: t.nome,
            vendidos: Number(t.quantidade || 0),
            foto: prod?.foto || "/assets/demo/placeholder.webp",
            setor: prod?.setor,
          };
        })
      : [...produtos].sort((a, b) => (b.vendidos || 0) - (a.vendidos || 0)).slice(0, 5);
  const maxTop = Math.max(1, ...top.map((p) => p.vendidos || 0));

  // Semana real: últimos 7 dias vindos da API (dash.porDia)
  const semanaApi: { dia: string; label: string; faturamento: number; contas: number }[] =
    Array.isArray(dash?.porDia) ? dash.porDia : [];
  const semana =
    semanaApi.length > 0
      ? semanaApi.map((d) => ({
          dia: d.label || d.dia,
          valor: Number(d.faturamento || 0),
        }))
      : faturamentoSemana(sessoes).map((d) =>
          d.dia === "Hoje" ? { ...d, valor: fatHoje + emAberto } : d
        );
  const maxSemana = Math.max(1, ...semana.map((d) => d.valor));

  const cards = [
    {
      icon: CircleAlert,
      label: "faturamento hoje",
      valor: loadingDash ? "…" : BRL(fatHoje),
      sub: "sessões fechadas no caixa",
      tom: "from-brand-500/20 text-brand-600",
    },
    {
      icon: Users,
      label: "consumo em aberto",
      valor: loadingDash ? "…" : BRL(emAberto),
      sub: "comandas no salão",
      tom: "from-navy-700/15 text-navy-700",
    },
    {
      icon: Receipt,
      label: "pedidos no dia",
      valor: loadingDash ? "…" : String(qtdPedidos),
      sub: "criados hoje",
      tom: "from-violet-500/20 text-violet-700",
    },
    {
      icon: TrendingUp,
      label: "ticket médio",
      valor: loadingDash ? "…" : BRL(ticket),
      sub: "por conta fechada",
      tom: "from-teal-500/20 text-teal-600",
    },
  ];

  return (
    <div className="space-y-4">
      {/* métricas */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="glass rounded-3xl p-5 relative overflow-hidden"
          >
            <div className={cn("glow-orb absolute -top-10 -right-10 size-24 bg-gradient-to-br to-transparent opacity-30", c.tom.split(" ")[0])} />
            <c.icon className={cn("size-5", c.tom.split(" ")[1])} />
            <p className="mt-3 font-display text-4xl sm:text-5xl text-navy-900 leading-none">{c.valor}</p>
            <p className="mt-1.5 text-[10px] uppercase tracking-[0.22em] font-bold text-slate-500">{c.label}</p>
            <p className="text-[10px] text-slate-400">{c.sub}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* gráfico semana */}
        <div className="glass-deep noise rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-display text-3xl text-navy-900">Semana do Pier</h3>
            <Badge tone="zinc">faturamento / dia</Badge>
          </div>
          <div className="flex items-end gap-2.5 sm:gap-4 h-44">
            {semana.map((d) => (
              <div key={d.dia} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "w-full rounded-t-lg transition-all",
                    d.dia === "Hoje"
                      ? "bg-gradient-to-t from-brand-600 to-brand-400 shadow-[0_0_28px_-4px_rgba(0,196,180,0.45)]"
                      : "bg-slate-100"
                  )}
                  style={{ height: `${Math.max(4, (d.valor / maxSemana) * 100)}%` }}
                />
                <span className={cn("text-[10px] font-bold uppercase tracking-wider", d.dia === "Hoje" ? "text-brand-600" : "text-slate-500")}>{d.dia}</span>
              </div>
            ))}
          </div>
          
        </div>

        {/* top produtos */}
        <div className="glass-deep noise rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-display text-3xl text-navy-900 flex items-center gap-2">
              <Trophy className="size-5 text-brand-600" /> Campeões de venda
            </h3>
            <Badge tone="amber">top 5</Badge>
          </div>
          <div className="space-y-3">
            {top.length === 0 && (
              <p className="text-sm text-slate-500">Nenhuma venda registrada hoje.</p>
            )}
            {top.map((p, i) => (
              <div key={p.id ?? p.nome} className="flex items-center gap-3">
                <img src={p.foto || "/assets/demo/placeholder.webp"} alt="" className="size-11 rounded-xl object-cover" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-navy-900 truncate">
                      <span className="font-mono text-[11px] text-slate-500 mr-1.5">#{i + 1}</span>
                      {p.nome}
                      {p.setor === "bar" && (
                        <span className="ml-1.5 rounded-md bg-violet-500/10 border border-violet-500/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-700">
                          bar
                        </span>
                      )}
                    </p>
                    <span className="font-mono text-xs text-slate-500 shrink-0">{p.vendidos} un.</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-100/80 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${((p.vendidos || 0) / maxTop) * 100}%` }}
                      transition={{ delay: 0.2 + i * 0.07, type: "spring", stiffness: 120, damping: 18 }}
                      className="h-full rounded-full bg-gradient-to-r from-brand-600 to-teal-600"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function Cardapio() {
  const produtos = usePub((s) => s.produtos);
  const categorias = usePub((s) => s.categorias);
  const toggle = usePub((s) => s.toggleProduto);
  const remover = usePub((s) => s.removerProduto);
  const addCategoria = usePub((s) => s.addCategoria);
  const renameCategoria = usePub((s) => s.renameCategoria);
  const removeCategoria = usePub((s) => s.removeCategoria);
  const moverCategoria = usePub((s) => s.moverCategoria);
  const [editando, setEditando] = useState<Produto | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [novaCat, setNovaCat] = useState("");
  /** ids de categorias expandidas — várias podem ficar abertas */
  const [abertas, setAbertas] = useState<Set<number>>(() => new Set());
  const [orfaosAberto, setOrfaosAberto] = useState(true);

  const catsOrdenadas = [...categorias].sort((a, b) => a.ordem - b.ordem);
  const nomesCat = new Set(catsOrdenadas.map((c) => c.nome));
  const orfaos = produtos.filter((p) => !nomesCat.has(p.categoria));

  const toggleCat = (id: number) => {
    setAbertas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cardProduto = (p: Produto) => (
    <motion.article
      key={p.id}
      layout
      className={cn(
        "rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden transition-opacity",
        !p.ativo && "opacity-55"
      )}
    >
      <div className="flex gap-3.5 p-3.5">
        <img src={p.foto} alt="" className="size-16 sm:size-20 rounded-2xl object-cover shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-navy-900 text-sm leading-tight truncate">{p.nome}</p>
            <span className="font-mono text-xs font-bold text-brand-600 shrink-0">{BRL(p.preco)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={p.tipo === "escolher" ? "sky" : p.tipo === "personalizavel" ? "violet" : "zinc"}>
              {p.tipo === "escolher" ? "escolher" : p.tipo === "personalizavel" ? "personalizável" : "simples"}
            </Badge>
            {p.estoque !== null && (
              <Badge tone={p.estoque <= 8 ? "rose" : "zinc"}>est. {p.estoque}</Badge>
            )}
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggle(p.id)}
              title={p.ativo ? "Desativar" : "Ativar"}
              className={cn(
                "btn-press grid place-items-center size-8 rounded-lg border cursor-pointer transition-colors",
                p.ativo
                  ? "bg-teal-500/10 border-teal-500/30 text-teal-600"
                  : "bg-slate-100/70 border-slate-200 text-slate-500"
              )}
            >
              {p.ativo ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setEditando(p)}
              title="Editar"
              className="btn-press grid place-items-center size-8 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-600 hover:text-brand-600 cursor-pointer"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => remover(p.id)}
              title="Excluir"
              className="btn-press grid place-items-center size-8 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-500 hover:text-rose-600 cursor-pointer"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </motion.article>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl text-navy-900 leading-none">Cardápio</h3>
          <p className="mt-1 text-[11px] text-slate-500">
            Toque na categoria para expandir · ↑↓ reordena · {produtos.length} produtos ·{" "}
            {produtos.filter((p) => p.ativo).length} ativos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!novaCat.trim()) return;
              addCategoria(novaCat);
              setNovaCat("");
            }}
          >
            <Input value={novaCat} onChange={setNovaCat} placeholder="Nova categoria" className="w-36 sm:w-48" />
            <Btn
              size="sm"
              onClick={() => {
                if (novaCat.trim()) {
                  addCategoria(novaCat);
                  setNovaCat("");
                }
              }}
            >
              <Plus className="size-4" /> Categoria
            </Btn>
          </form>
          <Btn size="sm" onClick={() => setNovoAberto(true)}>
            <Plus className="size-4" /> Produto
          </Btn>
        </div>
      </div>

      <ul className="space-y-2.5">
        {catsOrdenadas.map((c, i) => {
          const lista = produtos.filter((p) => p.categoria === c.nome);
          const open = abertas.has(c.id);
          return (
            <li key={c.id} className="rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden">
              {/* cabeçalho da categoria — ordem + expandir */}
              <div className="flex flex-wrap items-center gap-1 sm:gap-2 px-2 sm:px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleCat(c.id)}
                  className="btn-press flex items-center gap-2 flex-1 min-w-[10rem] text-left cursor-pointer rounded-xl hover:bg-slate-100 px-1.5 py-1 -ml-1"
                  aria-expanded={open}
                >
                  <span className="grid place-items-center size-7 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-500 shrink-0">
                    {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 w-4 tabular shrink-0">{i + 1}</span>
                  <span className="font-semibold text-sm sm:text-base text-navy-900 truncate">{c.nome}</span>
                  <Badge tone="zinc">{lista.length}</Badge>
                </button>

                <button
                  type="button"
                  title="Subir"
                  disabled={i === 0}
                  onClick={() => moverCategoria(c.id, -1)}
                  className="btn-press grid place-items-center size-8 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-600 hover:text-brand-600 disabled:opacity-30 cursor-pointer shrink-0"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Descer"
                  disabled={i === catsOrdenadas.length - 1}
                  onClick={() => moverCategoria(c.id, 1)}
                  className="btn-press grid place-items-center size-8 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-600 hover:text-brand-600 disabled:opacity-30 cursor-pointer shrink-0"
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Renomear"
                  onClick={() => {
                    const n = prompt("Nome da categoria:", c.nome);
                    if (n && n.trim()) renameCategoria(c.id, n);
                  }}
                  className="btn-press grid place-items-center size-8 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-600 hover:text-brand-600 cursor-pointer shrink-0"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={lista.length > 0 ? `Excluir categoria e ${lista.length} produto(s)` : "Excluir categoria"}
                  onClick={() => removeCategoria(c.id)}
                  className="btn-press grid place-items-center size-8 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-500 hover:text-rose-600 cursor-pointer shrink-0"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-0.5 border-t border-slate-200">
                      <div className="flex justify-end mb-2.5 pt-2">
                        <Btn size="sm" variant="ghost" onClick={() => setNovoAberto(true)}>
                          <Plus className="size-3.5" /> Produto nesta categoria
                        </Btn>
                      </div>
                      {lista.length === 0 ? (
                        <p className="text-xs text-slate-500 py-5 text-center border border-dashed border-slate-200 rounded-2xl">
                          Nenhum produto — adicione o primeiro
                        </p>
                      ) : (
                        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                          {lista.map((p) => cardProduto(p))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}

        {orfaos.length > 0 && (
          <li className="rounded-2xl border border-rose-400/40 bg-rose-600/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setOrfaosAberto((v) => !v)}
              className="btn-press flex w-full items-center gap-2 px-3 py-2.5 text-left cursor-pointer"
            >
              <span className="grid place-items-center size-7 rounded-lg bg-slate-100/70 border border-slate-200 text-rose-600">
                {orfaosAberto ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </span>
              <span className="font-semibold text-sm text-rose-700">Sem categoria</span>
              <Badge tone="rose">{orfaos.length}</Badge>
            </button>
            <AnimatePresence initial={false}>
              {orfaosAberto && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {orfaos.map((p) => cardProduto(p))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        )}
      </ul>

      <ProdutoForm produto={editando} onClose={() => setEditando(null)} />
      <ProdutoForm novo={novoAberto} onClose={() => setNovoAberto(false)} />
    </div>
  );
}

function ProdutoForm({ produto, novo, onClose }: { produto?: Produto | null; novo?: boolean; onClose: () => void }) {
  const produtos = usePub((s) => s.produtos);
  const cats = usePub((s) => s.categorias);
  const upsert = usePub((s) => s.upsertProduto);
  const open = !!produto || !!novo;
  const editando = !!produto;
  const nomesCat = [...cats].sort((a, b) => a.ordem - b.ordem).map((c) => c.nome);
  const catPadrao = nomesCat[0] || CATEGORIAS[0];

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [preco, setPreco] = useState("");
  const [categoria, setCategoria] = useState(catPadrao);
  const [tipo, setTipo] = useState<TipoProduto>("simples");
  const [foto, setFoto] = useState("");
  const [adicionais, setAdicionais] = useState("");
  const [removiveis, setRemoviveis] = useState("");
  const [controlaEstoque, setControlaEstoque] = useState(false);
  const [estoqueQtd, setEstoqueQtd] = useState("0");
  const [estoqueMin, setEstoqueMin] = useState("5");
  const [setor, setSetor] = useState<"cozinha" | "bar">("cozinha");
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const produtoId = produto?.id ?? null;
  useEffect(() => {
    if (produto) {
      setNome(produto.nome);
      setDescricao(produto.descricao);
      setPreco(String(produto.preco));
      setCategoria(produto.categoria);
      setTipo(produto.tipo);
      setFoto(produto.foto);
      setAdicionais(
        (produto.adicionais || []).map((a) => `${a.nome}:${a.preco}`).join(", ")
      );
      setRemoviveis((produto.removiveis || []).map((r) => r.nome).join(", "));
      const tem = produto.estoque !== null && produto.estoque !== undefined;
      setControlaEstoque(tem);
      setEstoqueQtd(tem ? String(produto.estoque) : "0");
      setEstoqueMin("5");
      setSetor(produto.setor === "bar" ? "bar" : "cozinha");
      setSalvando(false);
    } else if (novo) {
      setNome("");
      setDescricao("");
      setPreco("");
      setCategoria(catPadrao);
      setTipo("simples");
      setFoto("");
      setAdicionais("");
      setRemoviveis("");
      setControlaEstoque(false);
      setEstoqueQtd("0");
      setEstoqueMin("5");
      // default setor pela categoria (bebidas → bar)
      const catL = String(catPadrao || "").toLowerCase();
      const barish =
        catL.includes("bebida") ||
        catL.includes("suco") ||
        catL.includes("drink") ||
        catL.includes("cerveja") ||
        catL.includes("chopp") ||
        catL.includes("bar");
      setSetor(barish ? "bar" : "cozinha");
      setSalvando(false);
    }
    // só re-hidrata ao abrir outro produto (id) — evita fechar/reset no meio da edição
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoId, novo]);

  /* upload local → dataURL otimizado (espelha POST /api/admin/upload-foto com sharp) */
  const arquivo = (f: File) => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const max = 960;
      const esc = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * esc);
      canvas.height = Math.round(img.height * esc);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      setFoto(canvas.toDataURL("image/webp", 0.88));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const salvar = async () => {
    const precoN = Number(preco.replace(",", "."));
    if (!nome.trim() || !(precoN > 0) || salvando) return;
    const existentesAds = produto?.adicionais || [];
    const norm = (s: string) => s.trim().toLowerCase();
    const ads = adicionais
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const colon = s.lastIndexOf(":");
        const n = (colon >= 0 ? s.slice(0, colon) : s).trim();
        const pr = colon >= 0 ? s.slice(colon + 1) : "0";
        const prev = existentesAds.find((a) => norm(a.nome) === norm(n));
        return {
          id: prev?.id ?? `new-${Math.random().toString(36).slice(2, 8)}`,
          nome: n,
          preco: Number(String(pr).replace(",", ".")) || 0,
        };
      });
    const rems = removiveis
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((n) => ({ id: Math.random().toString(36).slice(2, 8), nome: n }));

    setSalvando(true);
    try {
      await upsert({
        id: produto ? produto.id : Math.max(0, ...produtos.map((p) => p.id)) + 1,
        nome: nome.trim(),
        descricao: descricao.trim() || descricaoPadrao(nome.trim(), categoria),
        preco: precoN,
        categoria,
        foto:
          foto ||
          "https://images.pexels.com/photos/18987002/pexels-photo-18987002.jpeg?auto=compress&cs=tinysrgb&w=900",
        tipo,
        adicionais: ads,
        removiveis: tipo === "personalizavel" ? rems : [],
        ativo: produto ? produto.ativo : true,
        setor,
        estoque: controlaEstoque ? Math.max(0, Number(estoqueQtd) || 0) : null,
        vendidos: produto ? produto.vendidos : 0,
      });
      onClose();
    } catch (e: any) {
      avisar(e?.message || "Erro ao salvar produto");
    } finally {
      setSalvando(false);
    }
  };

  const TIPOS: { id: TipoProduto; label: string; dica: string }[] = [
    { id: "simples", label: "Adicionar", dica: "sem opções — vai direto pro carrinho" },
    { id: "personalizavel", label: "Adicionar + Personalizar", dica: "adicionais multi + removíveis" },
    { id: "escolher", label: "Escolher", dica: "cliente marca UMA opção (tamanho/sabor)" },
  ];

  return (
    <Modal open={open} onClose={onClose} wide closeOnBackdrop={false}>
      <div className="p-5 sm:p-7">
        <h3 className="font-display text-4xl text-navy-900 mb-5">{editando ? "Editar produto" : "Novo produto"}</h3>

        <div className="grid sm:grid-cols-[220px_1fr] gap-5">
          {/* foto */}
          <div>
            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 border border-dashed border-slate-300">
              {foto ? (
                <img src={foto} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-center p-4">
                  <div>
                    <Camera className="size-7 text-slate-400 mx-auto" />
                    <p className="text-[11px] text-slate-500 mt-2">Sem foto</p>
                  </div>
                </div>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                className="btn-press absolute inset-x-2.5 bottom-2.5 h-9 rounded-xl bg-white/80 backdrop-blur border border-slate-200 text-[11px] font-bold text-navy-900 inline-flex items-center justify-center gap-1.5 cursor-pointer hover:bg-white"
              >
                <Camera className="size-3.5" /> Enviar foto (WebP ~960px)
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && arquivo(e.target.files[0])} />
            </div>
            <div className="relative mt-2">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
              <input value={foto.startsWith("data:") ? "" : foto} onChange={(e) => setFoto(e.target.value)} placeholder="…ou cole um link https://" className="w-full h-10 rounded-xl bg-slate-100 border border-slate-200 pl-8.5 pr-3 text-[11px] text-navy-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500/50" />
            </div>
            {foto.startsWith("data:") && <p className="mt-1.5 text-[10px] text-teal-600 font-mono">webp HQ · ~960px · salvo no banco</p>}
          </div>

          {/* campos */}
          <div className="space-y-3">
            <Input value={nome} onChange={setNome} placeholder="Nome do produto" />
            <Input value={descricao} onChange={setDescricao} placeholder="Descrição curta" />
            <div className="grid grid-cols-2 gap-3">
              <Input value={preco} onChange={setPreco} placeholder="0,00" prefix="R$" type="number" />
              <div className="relative">
                <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full h-12 rounded-2xl bg-slate-100 border border-slate-200 px-4 text-sm text-navy-900 focus:outline-none focus:border-brand-500/60 appearance-none cursor-pointer">
                  {(nomesCat.length ? nomesCat : CATEGORIAS).map((c) => <option key={c} value={c} className="bg-white">{c}</option>)}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-100/50 p-3.5 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={controlaEstoque}
                  onChange={(e) => setControlaEstoque(e.target.checked)}
                  className="size-4 rounded border-slate-300 accent-brand-500"
                />
                <span className="text-sm text-navy-900 font-semibold">Controlar estoque</span>
                <span className="text-[11px] text-slate-500 hidden sm:inline">baixa automática a cada pedido</span>
              </label>
              {controlaEstoque && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-bold">Quantidade</p>
                    <Input value={estoqueQtd} onChange={setEstoqueQtd} placeholder="0" type="number" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-bold">Alerta mínimo</p>
                    <Input value={estoqueMin} onChange={setEstoqueMin} placeholder="5" type="number" />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Setor de produção</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: "cozinha" as const, label: "Cozinha", dica: "comida / chapa" },
                  { id: "bar" as const, label: "Bar", dica: "bebidas / drinks" },
                ]).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSetor(s.id)}
                    className={cn(
                      "btn-press rounded-xl border px-3 py-2.5 text-left transition-all",
                      setor === s.id
                        ? "bg-brand-500/10 border-brand-500/40 text-brand-700"
                        : "bg-slate-100 border-slate-200 text-slate-500 hover:text-navy-800"
                    )}
                  >
                    <p className="text-sm font-bold">{s.label}</p>
                    <p className="text-[10px] opacity-80">{s.dica}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              {TIPOS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTipo(t.id)}
                  className={cn(
                    "btn-press w-full flex items-center gap-3 rounded-2xl border p-3 text-left cursor-pointer transition-all",
                    tipo === t.id ? "border-brand-500/50 bg-brand-500/10" : "border-slate-200 bg-slate-100/40 hover:border-slate-300"
                  )}
                >
                  <span className={cn("grid place-items-center size-4.5 rounded-full border-2", tipo === t.id ? "border-brand-400" : "border-slate-300")}>
                    {tipo === t.id && <span className="size-2 rounded-full bg-brand-400" />}
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-navy-900">{t.label}</span>
                    <span className="block text-[11px] text-slate-500">{t.dica}</span>
                  </span>
                </button>
              ))}
            </div>

            <Input value={adicionais} onChange={setAdicionais} placeholder="Adicionais: Nome:preço, Bacon:5, Queijo:3.5" />
            {tipo === "personalizavel" && (
              <Input value={removiveis} onChange={setRemoviveis} placeholder="Removíveis: Cebola, Maionese…" />
            )}
            <Btn
              full
              size="lg"
              onClick={() => void salvar()}
              disabled={salvando || !nome.trim() || !(Number(preco.replace(",", ".")) > 0)}
            >
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar produto"}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}


/* ================= GARÇONS ================= */
type GarcomRow = {
  id: number;
  nome: string;
  token: string;
  ativo: boolean;
  criado_em?: string;
  entregas?: number;
};

function Garcons() {
  const [lista, setLista] = useState<GarcomRow[]>([]);
  const [nome, setNome] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async () => {
    try {
      setErro(null);
      const rows = await api.listGarcons();
      setLista(
        (rows || []).map((g) => ({
          id: Number(g.id),
          nome: String(g.nome),
          token: String(g.token),
          ativo: g.ativo !== false,
          criado_em: g.criado_em,
          entregas: Number(g.entregas || 0),
        }))
      );
    } catch (e: any) {
      setErro(e.message || "Falha ao listar garçons");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  const linkGarcom = (token: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/#/garcom/${token}`;
  };

  const criar = async () => {
    const n = nome.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await api.criarGarcom(n);
      setNome("");
      await carregar();
    } catch (e: any) {
      avisar(e.message || "Erro ao criar garçom");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (g: GarcomRow) => {
    setBusy(true);
    try {
      await api.setGarcomAtivo(g.id, !g.ativo);
      await carregar();
    } catch (e: any) {
      avisar(e.message || "Erro ao atualizar");
    } finally {
      setBusy(false);
    }
  };

  const remover = async (g: GarcomRow) => {
    if (!(await confirmar(`Remover o garçom "${g.nome}"? O link dele deixa de funcionar.`))) return;
    setBusy(true);
    try {
      await api.removerGarcom(g.id);
      await carregar();
    } catch (e: any) {
      avisar(e.message || "Erro ao remover");
    } finally {
      setBusy(false);
    }
  };

  const copiar = async (g: GarcomRow) => {
    try {
      await navigator.clipboard.writeText(linkGarcom(g.token));
      setCopiado(g.id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      prompt("Copie o link do garçom:", linkGarcom(g.token));
    }
  };

  return (
    <div className="space-y-6">
      <section className="glass rounded-3xl p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h3 className="font-display text-2xl text-navy-900 leading-none">Garçons</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              Cada um recebe um link único (UUID). Abre a fila de pedidos prontos no celular.
            </p>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void criar();
            }}
          >
            <Input value={nome} onChange={setNome} placeholder="Nome do garçom" className="w-44 sm:w-56" />
            <Btn size="sm" disabled={busy || !nome.trim()} onClick={() => void criar()}>
              <UserPlus className="size-4" /> Cadastrar
            </Btn>
          </form>
        </div>

        {erro && (
          <p className="mb-3 rounded-xl border border-rose-400/40 bg-rose-600/10 px-3 py-2 text-xs text-rose-700">
            {erro}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-slate-500 py-8 text-center">Carregando…</p>
        ) : lista.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm text-slate-500">Nenhum garçom cadastrado.</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Cadastre um garçom e abra o link dele no celular. Só quem entrega pelo link move o pedido para o caixa (status entregue + valor na sessão).
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {lista.map((g) => (
              <li
                key={g.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-3 bg-slate-100",
                  g.ativo ? "border-slate-200" : "border-slate-200 opacity-70"
                )}
              >
                <div className="flex-1 min-w-[10rem]">
                  <p className="font-semibold text-navy-900 text-sm">{g.nome}</p>
                  <p className="font-mono text-[10px] text-slate-500 truncate max-w-[16rem] sm:max-w-md">
                    {g.token}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {g.entregas ?? 0} entrega{(g.entregas ?? 0) === 1 ? "" : "s"}
                    {!g.ativo && " · desativado"}
                  </p>
                </div>
                <Badge tone={g.ativo ? "lime" : "zinc"}>{g.ativo ? "ativo" : "off"}</Badge>
                <button
                  type="button"
                  title="Copiar link"
                  onClick={() => void copiar(g)}
                  className="btn-press grid place-items-center size-9 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-600 hover:text-brand-600 cursor-pointer"
                >
                  {copiado === g.id ? <span className="text-[10px] font-bold text-teal-600">OK</span> : <Copy className="size-3.5" />}
                </button>
                <button
                  type="button"
                  title="Abrir fila"
                  onClick={() => ir(`/garcom/${g.token}`)}
                  className="btn-press grid place-items-center size-9 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-600 hover:text-brand-600 cursor-pointer"
                >
                  <Link2 className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={g.ativo ? "Desativar" : "Ativar"}
                  disabled={busy}
                  onClick={() => void toggle(g)}
                  className={cn(
                    "btn-press grid place-items-center size-9 rounded-lg border cursor-pointer",
                    g.ativo
                      ? "bg-teal-500/10 border-teal-500/30 text-teal-600"
                      : "bg-slate-100/70 border-slate-200 text-slate-500"
                  )}
                >
                  {g.ativo ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </button>
                <button
                  type="button"
                  title="Remover"
                  disabled={busy}
                  onClick={() => void remover(g)}
                  className="btn-press grid place-items-center size-9 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-500 hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-slate-500 text-center">
        O link do garçom é público no token — quem tiver a URL acessa a fila de prontos. Desative ou apague se o celular for perdido.
      </p>
    </div>
  );
}

/* ================= MESAS ================= */
function mesaClienteUrl(token: string) {
  if (typeof window === "undefined") return `#/mesa/${token}`;
  const base = `${window.location.origin}${window.location.pathname || "/"}`.replace(/\/$/, "");
  return `${base}#/mesa/${token}`;
}

function Mesas() {
  const mesas = usePub((s) => s.mesas);
  const sessoes = usePub((s) => s.sessoes);
  const pedidos = usePub((s) => s.pedidos);
  const fecharSessao = usePub((s) => s.fecharSessao);
  const [copiado, setCopiado] = useState<number | null>(null);

  const copiarLink = async (token: string, id: number) => {
    const url = mesaClienteUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(id);
      setTimeout(() => setCopiado((c) => (c === id ? null : c)), 2000);
    } catch {
      prompt("Copie o link da mesa:", url);
    }
  };

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4 max-w-xl">
        Cada mesa tem um link/QR fixo. Imprima o QR e cole na mesa — o cliente escaneia e já entra no cardápio com o número certo. Sem menu de equipe no celular do cliente.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {mesas.map((m) => {
          const s = sessoes.find((x) => x.mesaId === m.id && x.status === "aberta");
          const consumo = s ? totalSessao(pedidos, s.id) : 0;
          const url = mesaClienteUrl(m.token);
          return (
            <div
              key={m.id}
              className={cn(
                "relative glass rounded-3xl p-4 sm:p-5 text-center overflow-hidden",
                s && "ring-brand"
              )}
            >
              <div className="flex items-center justify-between">
                <Badge tone={s ? "amber" : "zinc"} pulse={!!s}>
                  {s ? "ocupada" : "livre"}
                </Badge>
                <span className="font-mono text-[10px] text-slate-400">#{String(m.numero).padStart(2, "0")}</span>
              </div>
              <p className="font-display text-4xl sm:text-5xl text-navy-900 mt-3 leading-none">{m.numero}</p>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mt-1">{m.nome}</p>

              <div className="mt-4 mx-auto w-fit rounded-2xl papel-qr p-2.5">
                <QRCodeSVG value={url} size={108} fgColor="#0a2540" level="M" includeMargin={false} />
              </div>

              <p className="mt-3 font-mono text-[10px] text-slate-500 break-all leading-snug px-1">{url}</p>

              <div className="mt-3 flex flex-col gap-1.5">
                <Btn size="sm" full onClick={() => void copiarLink(m.token, m.id)}>
                  <Copy className="size-3.5" /> {copiado === m.id ? "Copiado!" : "Copiar link da mesa"}
                </Btn>
                {s ? (
                  <>
                    <p className="font-mono text-sm text-brand-600 py-1">{BRL(consumo)} consumo</p>
                    <Btn size="sm" variant="danger" full onClick={() => fecharSessao(s.id, "dinheiro")}>
                      Liberar mesa
                    </Btn>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================= ESTOQUE (por categoria) ================= */
function Estoque() {
  const produtos = usePub((s) => s.produtos);
  const categorias = usePub((s) => s.categorias);
  const setEstoque = usePub((s) => s.setEstoque);
  const ativar = usePub((s) => s.ativarControleEstoque);
  const hydrateCardapio = usePub((s) => s.hydrateCardapio);
  const [abertas, setAbertas] = useState<Set<number | string>>(() => new Set());

  useEffect(() => {
    void hydrateCardapio();
  }, [hydrateCardapio]);

  const pedirQtd = (titulo: string, atual?: number) => {
    const raw = window.prompt(titulo, atual != null ? String(atual) : "10");
    if (raw == null) return null;
    const n = Math.floor(Number(String(raw).replace(",", ".")));
    if (!Number.isFinite(n) || n < 0) {
      avisar("Quantidade inválida");
      return null;
    }
    return n;
  };

  const ordemCat = useMemo(() => {
    return [...categorias].sort((a, b) => a.ordem - b.ordem);
  }, [categorias]);

  const grupos = useMemo(() => {
    const byName = new Map<string, typeof produtos>();
    for (const p of produtos) {
      const k = p.categoria || "Outros";
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k)!.push(p);
    }
    const ordered: { id: number | string; nome: string; itens: typeof produtos }[] = [];
    for (const c of ordemCat) {
      const itens = byName.get(c.nome) || [];
      if (itens.length) {
        ordered.push({ id: c.id, nome: c.nome, itens });
        byName.delete(c.nome);
      }
    }
    for (const [nome, itens] of byName) {
      if (itens.length) ordered.push({ id: nome, nome, itens });
    }
    return ordered;
  }, [produtos, ordemCat]);

  useEffect(() => {
    if (abertas.size === 0 && grupos.length) {
      setAbertas(new Set(grupos.slice(0, 3).map((g) => g.id)));
    }
  }, [grupos]);

  const toggle = (id: number | string) => {
    setAbertas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const controlados = produtos.filter((p) => p.estoque !== null);
  const baixos = controlados.filter((p) => (p.estoque ?? 0) <= 8);

  const linhaProduto = (p: (typeof produtos)[0]) => {
    const controla = p.estoque !== null;
    const q = p.estoque ?? 0;
    return (
      <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2.5">
        <img src={p.foto} alt="" className="size-12 rounded-xl object-cover shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-navy-900 truncate">{p.nome}</p>
          <p className="text-[10px] text-slate-500">
            {controla ? (
              <span className={q <= 8 ? "text-rose-600 font-bold" : "text-teal-600 font-mono"}>{q} un. em estoque</span>
            ) : (
              "sem controle"
            )}
          </p>
        </div>
        {controla ? (
          <div className="flex flex-wrap gap-1.5 justify-end">
            <button
              type="button"
              onClick={() => {
                const n = pedirQtd(`Quantas unidades ENTRARAM?\n(atual: ${q})`, 10);
                if (n != null) setEstoque(p.id, q + n);
              }}
              className="btn-press h-8 px-2.5 rounded-lg bg-teal-500/10 border border-teal-500/30 text-teal-600 text-[11px] font-bold cursor-pointer"
            >
              + entrada
            </button>
            <button
              type="button"
              onClick={() => {
                const n = pedirQtd("Definir estoque absoluto:", q);
                if (n != null) setEstoque(p.id, n);
              }}
              className="btn-press h-8 px-2.5 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-600 text-[11px] font-bold cursor-pointer"
            >
              definir
            </button>
            <button
              type="button"
              onClick={() => setEstoque(p.id, Math.max(0, q - 1))}
              className="btn-press h-8 px-2.5 rounded-lg bg-slate-100/70 border border-slate-200 text-slate-500 text-[11px] font-bold cursor-pointer"
            >
              −1
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              const n = pedirQtd("Ativar estoque. Quantas unidades tem agora?", 20);
              if (n != null) ativar(p.id, n);
            }}
            className="btn-press h-9 px-3 rounded-xl border border-brand-500/40 bg-brand-500/10 text-brand-700 text-[11px] font-bold cursor-pointer"
          >
            Ativar + qtd
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {baixos.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-400/40 bg-rose-600/10 p-4">
          <CircleAlert className="size-5 text-rose-600 shrink-0" />
          <p className="text-sm text-rose-700">
            <b>
              {baixos.length} {baixos.length === 1 ? "item" : "itens"} acabando:
            </b>{" "}
            {baixos.map((x) => `${x.nome} (${x.estoque})`).join(" · ")}
          </p>
        </div>
      )}

      {grupos.map((g) => {
        const open = abertas.has(g.id);
        const nCtrl = g.itens.filter((x) => x.estoque !== null).length;
        return (
          <section key={String(g.id)} className="glass rounded-3xl overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(g.id)}
              className="btn-press w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-slate-100/70"
            >
              {open ? <ChevronDown className="size-4 text-brand-600" /> : <ChevronRight className="size-4 text-slate-500" />}
              <span className="font-display text-2xl text-navy-900 flex-1">{g.nome}</span>
              <Badge tone="zinc">
                {g.itens.length} · {nCtrl} c/ estoque
              </Badge>
            </button>
            {open && <div className="px-3 pb-3 space-y-2">{g.itens.map(linhaProduto)}</div>}
          </section>
        );
      })}

      <p className="text-[11px] text-slate-500 text-center">
        Pedidos na mesa dão baixa automática. Ative o controle e informe a quantidade colocada.
      </p>
    </div>
  );
}

/* ================= RELATÓRIO (API real) ================= */
function Relatorio() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return dataLocal(d);
  });
  const [to, setTo] = useState(() => dataLocal());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const out = await api.adminRelatorio(from, to);
      setData(out);
    } catch (e: any) {
      setErro(e.message || "Falha ao carregar relatório");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumo = data?.resumo || {};
  const contas = Array.isArray(data?.contas) ? data.contas : [];
  const porDia = Array.isArray(data?.porDia) ? data.porDia : [];
  const porForma = resumo.porFormaPagamento || {};
  const top = Array.isArray(resumo.topProdutos) ? resumo.topProdutos : [];
  const faturamento = Number(resumo.faturamento ?? 0);
  const qtdContas = Number(resumo.contasFechadas ?? contas.length);
  const ticket = Number(resumo.ticketMedio ?? (qtdContas ? faturamento / qtdContas : 0));

  const baixarCSV = () => {
    if (!contas.length) {
      avisar("Nada para exportar neste período");
      return;
    }
    const header = "id,mesa,cliente,valor,desconto,taxa,valorCobrado,forma,fechadaEm";
    const body = contas
      .map((c: any) =>
        [c.id, c.mesa, c.cliente ?? "", c.valor, c.desconto, c.taxaServico, c.valorCobrado, c.forma, c.fechadaEm]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([[header, body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <div className="glass rounded-3xl p-4 sm:p-5 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          De
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block h-11 rounded-xl bg-slate-100 border border-slate-200 px-3 text-sm text-navy-900"
          />
        </label>
        <label className="text-xs text-slate-500">
          Até
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block h-11 rounded-xl bg-slate-100 border border-slate-200 px-3 text-sm text-navy-900"
          />
        </label>
        <Btn size="sm" onClick={() => void buscar()} disabled={loading}>
          {loading ? "Carregando…" : "Buscar"}
        </Btn>
        <Btn size="sm" variant="outline" onClick={baixarCSV} disabled={!contas.length}>
          <Download className="size-3.5" /> CSV
        </Btn>
        <Btn
          size="sm"
          variant="lime"
          disabled={!data}
          onClick={() =>
            imprimirRelatorioPdf({
              from,
              to,
              resumo,
              contas,
              porDia,
              topProdutos: top,
            })
          }
        >
          <FileText className="size-3.5" /> PDF / Imprimir
        </Btn>
      </div>

      {erro && (
        <p className="rounded-xl border border-rose-400/40 bg-rose-600/10 px-3 py-2 text-xs text-rose-700">{erro}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">faturamento</p>
          <p className="font-mono text-xl text-teal-600 font-bold mt-1">{BRL(faturamento)}</p>
        </div>
        <div className="glass rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">contas</p>
          <p className="font-mono text-xl text-navy-900 font-bold mt-1">{qtdContas}</p>
        </div>
        <div className="glass rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">ticket médio</p>
          <p className="font-mono text-xl text-brand-700 font-bold mt-1">{BRL(ticket)}</p>
        </div>
        <div className="glass rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">pedidos</p>
          <p className="font-mono text-xl text-navy-900 font-bold mt-1">{Number(resumo.pedidosTotal ?? 0)}</p>
        </div>
      </div>

      {Object.keys(porForma).length > 0 && (
        <div className="glass rounded-3xl p-4 sm:p-5">
          <h3 className="font-display text-2xl text-navy-900 mb-3">Por forma de pagamento</h3>
          <div className="grid sm:grid-cols-2 gap-2">
            {Object.entries(porForma).map(([k, v]) => (
              <div key={k} className="flex justify-between rounded-xl bg-slate-100 px-3 py-2 text-sm">
                <span className="text-slate-500">{k}</span>
                <span className="font-mono text-navy-900">{BRL(Number(v || 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {porDia.length > 0 && (
        <div className="glass rounded-3xl p-4 sm:p-5 overflow-x-auto">
          <h3 className="font-display text-2xl text-navy-900 mb-3">Por dia</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2 pr-3">Dia</th>
                <th className="py-2 pr-3">Contas</th>
                <th className="py-2">Faturamento</th>
              </tr>
            </thead>
            <tbody>
              {porDia.map((d: any) => (
                <tr key={d.dia} className="border-b border-slate-200 text-slate-600">
                  <td className="py-2 pr-3 font-mono text-xs">{d.dia}</td>
                  <td className="py-2 pr-3">{d.contas}</td>
                  <td className="py-2 font-mono text-teal-600">{BRL(Number(d.faturamento || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {top.length > 0 && (
        <div className="glass rounded-3xl p-4 sm:p-5">
          <h3 className="font-display text-2xl text-navy-900 mb-3">Top produtos</h3>
          <ul className="space-y-2">
            {top.slice(0, 10).map((p: any, i: number) => (
              <li key={p.id || i} className="flex justify-between text-sm border-b border-slate-200 py-1.5">
                <span className="text-slate-600 truncate pr-2">
                  {i + 1}. {p.nome || p.produto}
                </span>
                <span className="font-mono text-brand-700 shrink-0">
                  {p.qtd ?? p.quantidade ?? p.vendidos ?? "—"} un
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="glass-deep rounded-3xl p-4 sm:p-5 overflow-x-auto">
        <h3 className="font-display text-2xl text-navy-900 mb-3">Contas fechadas</h3>
        {!contas.length ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            {loading ? "Carregando…" : "Sem contas fechadas neste intervalo (só entram sessões já fechadas no caixa)."}
          </p>
        ) : (
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Mesa</th>
                <th className="py-2 pr-2">Cliente</th>
                <th className="py-2 pr-2">Cobrado</th>
                <th className="py-2 pr-2">Forma</th>
                <th className="py-2">Fechada</th>
              </tr>
            </thead>
            <tbody>
              {contas.slice(0, 200).map((c: any) => (
                <tr key={c.id} className="border-b border-slate-200 text-slate-600">
                  <td className="py-2 pr-2 font-mono text-[11px]">{c.id}</td>
                  <td className="py-2 pr-2">{c.mesa}</td>
                  <td className="py-2 pr-2 truncate max-w-[8rem]">{c.cliente || "—"}</td>
                  <td className="py-2 pr-2 font-mono text-teal-600">{BRL(Number(c.valorCobrado ?? c.valor ?? 0))}</td>
                  <td className="py-2 pr-2 text-[11px]">{c.forma || "—"}</td>
                  <td className="py-2 font-mono text-[10px] text-slate-500">
                    {c.fechadaEm ? String(c.fechadaEm).slice(0, 16).replace("T", " ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ================= FUNÇÕES (estoque + relatório + histórico + purge) ================= */


/** Converte linha do histórico (API) em Pedido para o cupom de impressão. */
function pedidoFromHistorico(p: any): Pedido {
  const itensRaw = Array.isArray(p.itens) ? p.itens : [];
  const itens: ItemPedido[] = itensRaw.map((it: any, idx: number) => {
    const qtd = Number(it.qtd ?? it.quantidade ?? 1) || 1;
    const precoBase = Number(it.precoBase ?? it.preco_unitario ?? it.preco ?? 0);
    const rawUnit = it.totalUnit ?? it.preco_total_unit ?? (Number(it.subtotal ?? it.total ?? 0) / qtd);
    const totalUnit = Number(rawUnit) || precoBase;
    const adicionais = Array.isArray(it.adicionais)
      ? it.adicionais.map((a: any) =>
          typeof a === "string"
            ? { id: a, nome: a, preco: 0 }
            : { id: String(a.id ?? a.nome), nome: String(a.nome ?? a), preco: Number(a.preco ?? 0) }
        )
      : [];
    const removidos = Array.isArray(it.removidos)
      ? it.removidos.map((r: any) => (typeof r === "string" ? r : String(r.nome ?? r)))
      : Array.isArray(it.removiveis)
        ? it.removiveis.map((r: any) => String(r.nome ?? r))
        : [];
    let escolha = null as ItemPedido["escolha"];
    if (it.escolha) {
      escolha =
        typeof it.escolha === "string"
          ? { id: it.escolha, nome: it.escolha, preco: 0 }
          : {
              id: String(it.escolha.id ?? it.escolha.nome),
              nome: String(it.escolha.nome ?? it.escolha),
              preco: Number(it.escolha.preco ?? 0),
            };
    }
    return {
      id: String(it.id ?? `h-${idx}`),
      produtoId: Number(it.produtoId ?? it.produto_id ?? 0),
      nome: String(it.nome ?? it.produto_nome ?? "Item"),
      qtd,
      precoBase,
      adicionais,
      removidos,
      escolha,
      obs: String(it.obs ?? it.observacao ?? ""),
      totalUnit,
      status: it.status,
      setor: it.setor === "bar" ? "bar" : it.setor === "cozinha" ? "cozinha" : undefined,
    };
  });

  const criadoRaw = p.criado_em || p.criadoEm || Date.now();
  const criadoEm =
    typeof criadoRaw === "number" ? criadoRaw : new Date(criadoRaw).getTime() || Date.now();

  const mesaNome =
    p.mesaNome ||
    (p.mesa != null ? `Mesa ${p.mesa}` : null) ||
    (p.mesa_numero != null ? `Mesa ${p.mesa_numero}` : "Mesa");

  return {
    id: Number(p.id),
    sessaoId: Number(p.sessaoId ?? p.sessao_id ?? 0),
    mesaId: Number(p.mesaId ?? p.mesa_id ?? 0),
    mesaNome: String(mesaNome),
    clienteNome: String(p.cliente_nome || p.clienteNome || p.cliente || ""),
    itens,
    status: (p.status as Pedido["status"]) || "entregue",
    criadoEm,
    total: Number(p.totalPedido ?? p.total ?? 0),
  };
}

/* ================= HISTÓRICO EXPANDÍVEL ================= */
function HistoricoPedidos({
  histFrom,
  setHistFrom,
  histTo,
  setHistTo,
  hist,
  histMsg,
  busy,
  onBuscar,
}: {
  histFrom: string;
  setHistFrom: (v: string) => void;
  histTo: string;
  setHistTo: (v: string) => void;
  hist: any[];
  histMsg: string | null;
  busy: boolean;
  onBuscar: () => void;
}) {
  const [aberto, setAberto] = useState<number | null>(null);

  const toggle = (id: number) => setAberto((cur) => (cur === id ? null : id));

  return (
    <section className="glass rounded-3xl p-5">
      <h3 className="font-display text-2xl text-navy-900 mb-1">Histórico de pedidos</h3>
      <p className="text-[11px] text-slate-500 mb-4">
        Clique em um pedido para ver itens, adicionais, total e imprimir o cupom.
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-slate-500">
          De
          <input
            type="date"
            value={histFrom}
            onChange={(e) => setHistFrom(e.target.value)}
            className="mt-1 block h-11 rounded-xl bg-slate-100 border border-slate-200 px-3 text-sm text-navy-900"
          />
        </label>
        <label className="text-xs text-slate-500">
          Até
          <input
            type="date"
            value={histTo}
            onChange={(e) => setHistTo(e.target.value)}
            className="mt-1 block h-11 rounded-xl bg-slate-100 border border-slate-200 px-3 text-sm text-navy-900"
          />
        </label>
        <Btn size="sm" disabled={busy} onClick={onBuscar}>
          Buscar
        </Btn>
      </div>
      {histMsg && <p className="mt-3 text-xs text-slate-500">{histMsg}</p>}
      <div className="mt-4 max-h-[28rem] overflow-y-auto space-y-2">
        {hist.length === 0 && !busy && (
          <p className="text-sm text-slate-500 py-6 text-center">Nenhum pedido neste período.</p>
        )}
        {hist.slice(0, 100).map((p: any) => {
          const id = Number(p.id);
          const isOpen = aberto === id;
          const itens = Array.isArray(p.itens) ? p.itens : [];
          const total = Number(p.totalPedido ?? p.total ?? 0);
          const criado = p.criado_em || p.criadoEm || "";
          return (
            <div
              key={id || JSON.stringify(p)}
              className="rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggle(id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <span className="font-mono text-[11px] text-slate-500 shrink-0">#{id}</span>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider shrink-0",
                    p.status === "entregue"
                      ? "bg-teal-500/10 text-teal-600 border border-teal-500/30"
                      : p.status === "concluido"
                        ? "bg-brand-500/10 text-brand-600 border border-brand-500/30"
                        : "bg-slate-100 text-slate-500 border border-slate-200"
                  )}
                >
                  {p.status}
                </span>
                <span className="text-xs text-navy-900 font-semibold truncate">
                  Mesa {p.mesa ?? p.mesa_numero ?? "—"}
                  {(p.cliente_nome || p.clienteNome) && (
                    <span className="text-slate-500 font-normal"> · {p.cliente_nome || p.clienteNome}</span>
                  )}
                </span>
                <span className="ml-auto font-mono text-xs text-teal-600 shrink-0">
                  {total > 0 ? BRL(total) : "—"}
                </span>
                <span className="text-slate-400 text-[10px] shrink-0">{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div className="border-t border-slate-200 px-3 py-3 space-y-2 bg-slate-200/60">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                    {criado && (
                      <span>
                        Criado: {String(criado).slice(0, 19).replace("T", " ")}
                      </span>
                    )}
                    {(p.garcom_nome || p.garcomNome) && (
                      <span>Garçom: {p.garcom_nome || p.garcomNome}</span>
                    )}
                    {(p.observacao_geral || p.observacaoGeral) && (
                      <span>Obs: {p.observacao_geral || p.observacaoGeral}</span>
                    )}
                  </div>
                  {itens.length === 0 ? (
                    <p className="text-xs text-slate-500">Sem itens neste registro.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {itens.map((it: any, idx: number) => (
                        <li
                          key={it.id ?? idx}
                          className="flex items-start justify-between gap-2 text-xs text-slate-600"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-navy-900">
                              {it.quantidade || 1}× {it.nome}
                            </span>
                            {Array.isArray(it.adicionais) && it.adicionais.length > 0 && (
                              <p className="text-[10px] text-brand-700">
                                + {it.adicionais.map((a: any) => a.nome || a).join(", ")}
                              </p>
                            )}
                            {Array.isArray(it.remocoes) && it.remocoes.length > 0 && (
                              <p className="text-[10px] text-rose-600">
                                sem {it.remocoes.join(", ")}
                              </p>
                            )}
                            {it.ponto_carne && (
                              <p className="text-[10px] text-slate-500">ponto: {it.ponto_carne}</p>
                            )}
                            {it.observacao && (
                              <p className="text-[10px] text-slate-500">obs: {it.observacao}</p>
                            )}
                          </div>
                          <span className="font-mono text-[11px] text-slate-500 shrink-0">
                            {BRL(Number(it.totalLinha ?? (Number(it.preco_unitario || 0) * (it.quantidade || 1))))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                    <Btn
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const forma =
                          p.forma_pagamento ||
                          p.formaPagamento ||
                          p.forma ||
                          p.pagamento_forma ||
                          null;
                        imprimirComandaHistorico(pedidoFromHistorico(p), {
                          formaPagamento: forma,
                        });
                      }}
                    >
                      <Printer className="size-3.5" /> Imprimir cupom
                    </Btn>
                    <span className="text-xs font-bold text-teal-600">
                      Total {BRL(total)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}


function Funcoes() {
  const [sub, setSub] = useState<"estoque" | "relatorio" | "historico" | "purge">("estoque");
  const [histFrom, setHistFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return dataLocal(d);
  });
  const [histTo, setHistTo] = useState(() => dataLocal());
  const [hist, setHist] = useState<any[]>([]);
  const [histMsg, setHistMsg] = useState<string | null>(null);
  const [purgeBefore, setPurgeBefore] = useState("");
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subs = [
    { id: "estoque" as const, label: "Estoque", icon: Boxes },
    { id: "relatorio" as const, label: "Relatório", icon: FileText },
    { id: "historico" as const, label: "Histórico", icon: Receipt },
    { id: "purge" as const, label: "Limpar", icon: Trash2 },
  ];

  const buscarHist = async () => {
    setBusy(true);
    setHistMsg(null);
    try {
      const rows = await api.adminPedidos(histFrom, histTo);
      setHist(Array.isArray(rows) ? rows : []);
      setHistMsg(`${Array.isArray(rows) ? rows.length : 0} pedido(s)`);
    } catch (e: any) {
      setHist([]);
      setHistMsg(e.message || "Erro ao buscar histórico");
    } finally {
      setBusy(false);
    }
  };

  const previewPurge = async () => {
    if (!purgeBefore) {
      avisar("Informe a data");
      return;
    }
    setBusy(true);
    try {
      const out = await api.purgeHistorico({ before: purgeBefore, dryRun: true, confirm: false });
      setPurgeMsg(
        `Prévia: ${out.sessoes ?? out.count ?? out.wouldDelete ?? JSON.stringify(out)} — sessões fechadas antes de ${purgeBefore}.`
      );
    } catch (e: any) {
      setPurgeMsg(e.message || "Erro na prévia");
    } finally {
      setBusy(false);
    }
  };

  const executarPurge = async () => {
    if (!purgeBefore) {
      avisar("Informe a data");
      return;
    }
    if (!(await confirmar(`Apagar DEFINITIVAMENTE contas fechadas antes de ${purgeBefore}? Não dá para desfazer.`, { perigo: true }))) return;
    setBusy(true);
    try {
      const out = await api.purgeHistorico({ before: purgeBefore, dryRun: false, confirm: true });
      setPurgeMsg(`Removido: ${JSON.stringify(out)}`);
    } catch (e: any) {
      setPurgeMsg(e.message || "Erro ao purgar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1 rounded-2xl bg-slate-100 border border-slate-200 p-1">
        {subs.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSub(s.id)}
            className={cn(
              "btn-press relative flex items-center gap-1.5 rounded-xl px-3 h-9 text-xs font-bold cursor-pointer transition-colors",
              sub === s.id ? "text-white" : "text-slate-500 hover:text-navy-800"
            )}
          >
            {sub === s.id && (
              <motion.span
                layoutId="fn-sub"
                className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand-500 to-teal-600"
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <s.icon className="relative z-10 size-3.5" />
            <span className="relative z-10">{s.label}</span>
          </button>
        ))}
      </nav>

      {sub === "estoque" && <Estoque />}
      {sub === "relatorio" && <Relatorio />}

      {sub === "historico" && (
        <HistoricoPedidos
          histFrom={histFrom}
          setHistFrom={setHistFrom}
          histTo={histTo}
          setHistTo={setHistTo}
          hist={hist}
          histMsg={histMsg}
          busy={busy}
          onBuscar={() => void buscarHist()}
        />
      )}

      {sub === "purge" && (
        <section className="glass rounded-3xl p-5 border border-rose-400/40">
          <h3 className="font-display text-2xl text-navy-900 mb-1">Limpar histórico</h3>
          <p className="text-[11px] text-slate-500 mb-4">
            Apaga permanentemente contas <b className="text-slate-600">fechadas</b> com fechamento{" "}
            <b className="text-slate-600">antes</b> da data. Não mexe em mesas abertas.
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-xs text-slate-500">
              Antes de
              <input
                type="date"
                value={purgeBefore}
                onChange={(e) => setPurgeBefore(e.target.value)}
                className="mt-1 block h-11 rounded-xl bg-slate-100 border border-slate-200 px-3 text-sm text-navy-900"
              />
            </label>
            <Btn size="sm" variant="outline" disabled={busy} onClick={() => void previewPurge()}>
              Ver quantos
            </Btn>
            <Btn size="sm" variant="danger" disabled={busy} onClick={() => void executarPurge()}>
              Apagar
            </Btn>
          </div>
          {purgeMsg && <p className="mt-3 text-xs text-brand-700">{purgeMsg}</p>}
        </section>
      )}
    </div>
  );
}

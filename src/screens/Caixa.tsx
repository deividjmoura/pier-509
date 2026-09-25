import { AnimatePresence, motion } from "framer-motion";
import {
  Banknote, Check, CircleDollarSign, Copy, CreditCard, HandCoins, Minus,
  Plus, QrCode, Receipt, Split, Timer, Users, Wallet, X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import { OpsShell, useAnuncios } from "../components/OpsShell";
import { useGuarda } from "../lib/guarda";
import { Carregando, Badge, Btn, LivePill } from "../components/ui";
import { useAgora } from "../router";
import type { FormaPagamento, Sessao } from "../lib/types";
import { FORMAS, consumoSessao, pagoSessao, usePub } from "../store/usePub";
import { api } from "../lib/api";
import { BRL, elapsed, montarPixEMV } from "../lib/utils";
import type { PixConfig } from "../lib/types";
import { cn } from "../utils/cn";

export default function Caixa() {
  const { checando } = useGuarda(["admin", "caixa"]);

  useAnuncios("caixa");  useAgora(1000);

  const sessoes = usePub((s) => s.sessoes);
  const lastError = usePub((s) => s.lastError);
  const hydrateCaixa = usePub((s) => s.hydrateCaixa);
  useEffect(() => {
    void hydrateCaixa();
    const t = setInterval(() => void hydrateCaixa(), 10000);
    return () => clearInterval(t);
  }, [hydrateCaixa]);

  const pedidos = usePub((s) => s.pedidos);
  const [selId, setSelId] = useState<number | null>(null);

  const abertas = sessoes.filter((s) => s.status === "aberta");
  const selecionada = abertas.find((s) => s.id === selId) || abertas[0] || null;

  const totalSalao = abertas.reduce((a, s) => {
    const bruto = consumoSessao(s, pedidos) - s.desconto + s.taxa;
    const pago = s.valorPago != null ? s.valorPago : pagoSessao(s);
    return a + Math.max(0, bruto - pago);
  }, 0);

  const extras = (
    <div className="flex items-center gap-2">
      <Badge tone="amber" pulse>{abertas.length} abertas</Badge>
      <Badge tone="lime">a receber · {BRL(Math.max(0, totalSalao))}</Badge>
    </div>
  );

  if (checando) return <Carregando />;

  return (
    <OpsShell ativo="caixa" kicker="operação · caixa" titulo={<>
      {lastError && (
        <p className="mb-4 rounded-2xl border border-rose-400/40 bg-rose-600/10 px-4 py-3 text-sm text-rose-700">{lastError}</p>
      )}Fecha <span className="text-gradient">a conta</span></>} extra={extras}>
      <div className="grid gap-5 lg:grid-cols-12">
        {/* -------- lista de comandas -------- */}
        <section className="lg:col-span-5 xl:col-span-4">
          <h2 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.26em] text-slate-500">
            <Receipt className="size-4 text-brand-600" /> comandas no salão <LivePill />
          </h2>
          <div className="space-y-2.5">
            <AnimatePresence mode="popLayout">
              {abertas.length === 0 && (
                <motion.div
                  key="vazio"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="rounded-3xl border border-dashed border-slate-200 py-16 text-center"
                >
                  <Wallet className="size-10 text-slate-400 mx-auto" />
                  <p className="mt-3 text-sm text-slate-500">Salão zerado — nenhuma conta aberta.</p>
                </motion.div>
              )}
              {abertas.map((s) => {
                const consumoBruto = consumoSessao(s, pedidos);
                const consumo = consumoBruto - s.desconto + s.taxa;
                const pago = s.valorPago != null ? s.valorPago : pagoSessao(s);
                const pct = consumo > 0 ? Math.min(100, (pago / consumo) * 100) : 0;
                const ativo = selecionada?.id === s.id;
                return (
                  <motion.button
                    key={s.id}
                    layout
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -30, scale: 0.95 }}
                    onClick={() => setSelId(s.id)}
                    className={cn(
                      "btn-press w-full text-left rounded-3xl p-4 cursor-pointer transition-all border",
                      ativo ? "glass-deep ring-brand border-brand-500/30" : "glass hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display text-3xl text-navy-900 leading-none">{s.mesaNome}</p>
                      <div className="flex items-center gap-1.5">
                        {s.pixAvisos > 0 && <Badge tone="lime" pulse>pix {s.pixAvisos}×</Badge>}
                        <Badge tone="zinc">
                          <Timer className="size-3" /> {elapsed(s.abertaEm)}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex items-end justify-between">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">consumo</p>
                        <p className="font-mono text-lg font-bold text-navy-900">{BRL(consumo)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">falta</p>
                        <p className={cn("font-mono text-lg font-bold", consumo - pago <= 0.005 ? "text-teal-600" : "text-amber-700")}>
                          {BRL(Math.max(0, consumo - pago))}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2.5 h-1.5 rounded-full bg-slate-100/80 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-600"
                        animate={{ width: `${pct}%` }}
                        transition={{ type: "spring", stiffness: 120, damping: 20 }}
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] font-mono text-slate-500 tabular">
                      pago {BRL(pago)} · {pct.toFixed(0)}%
                    </p>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        </section>

        {/* -------- detalhe -------- */}
        <section className="lg:col-span-7 xl:col-span-8">
          <AnimatePresence mode="wait">
            {selecionada ? (
              <motion.div
                key={selecionada.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <DetalheCaixa sessao={selecionada} />
              </motion.div>
            ) : (
              <motion.div key="nada" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center rounded-3xl border border-dashed border-slate-200 py-24 text-center">
                <div>
                  <CircleDollarSign className="size-12 text-slate-400 mx-auto" />
                  <h3 className="font-display text-4xl text-navy-900 mt-4">Caixa livre</h3>
                  <p className="text-sm text-slate-500 mt-1">Quando uma mesa pedir, a comanda aparece aqui em tempo real.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </OpsShell>
  );
}

/* =================== detalhe da comanda =================== */
function DetalheCaixa({ sessao }: { sessao: Sessao }) {
  const pedidos = usePub((s) => s.pedidos).filter((p) => p.sessaoId === sessao.id);
  const registrar = usePub((s) => s.registrarPagamento);
  const setDesconto = usePub((s) => s.setDesconto);
  const setTaxa = usePub((s) => s.setTaxa);
  const fecharSessao = usePub((s) => s.fecharSessao);

  const allPedidos = usePub((s) => s.pedidos);
  const consumo = consumoSessao(sessao, allPedidos);
  const total = Math.max(0, consumo - sessao.desconto + sessao.taxa);
  const pago = sessao.valorPago != null ? Number(sessao.valorPago) : pagoSessao(sessao);
  const restante = Math.max(0, Math.round((total - pago) * 100) / 100);

  const [pessoas, setPessoas] = useState(2);
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState<FormaPagamento>("pix");
  const [copiado, setCopiado] = useState(false);
  const [fechando, setFechando] = useState(false);

  useEffect(() => {
    setValor("");
    setFechando(false);
  }, [sessao.id]);

  const [pixCfg, setPixCfg] = useState<PixConfig | null>(null);
  const [pixAviso, setPixAviso] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .configPix()
      .then((c) => {
        if (!alive) return;
        if (c?.chave) setPixCfg({ chave: c.chave, nome: c.nome, cidade: c.cidade });
        /* chave presente mas inválida: mostra o motivo em vez de um QR que o
           banco recusa silenciosamente no meio do atendimento. */
        if (c && c.chaveValida === false) setPixAviso(c.aviso || "Confira PIX_CHAVE no servidor");
      })
      .catch(() => {
        /* sem PIX configurado no servidor */
      });
    return () => {
      alive = false;
    };
  }, []);

  const pixCodigo = useMemo(() => {
    if (!pixCfg?.chave) return "";
    return montarPixEMV({
      chave: pixCfg.chave,
      nome: pixCfg.nome || "RECEBEDOR",
      cidade: pixCfg.cidade || "BRASIL",
      valor: restante > 0.005 ? restante : total,
      txid: `SESSAO${sessao.id}`,
    });
  }, [pixCfg, restante, total, sessao.id]);

  const usarPorPessoa = () => {
    if (pessoas > 0) setValor((restante / pessoas).toFixed(2));
  };

  const podeRegistrar = Number(valor) > 0.004 && Number(valor) <= restante + 0.01;

  const fechar = () => {
    fecharSessao(sessao.id, forma);
    setFechando(false);
  };

  const copiarPix = async () => {
    try {
      await navigator.clipboard.writeText(pixCodigo);
    } catch {/* ok */}
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  return (
    <div className="glass-deep noise rounded-3xl overflow-hidden">
      {/* topo */}
      <div className="relative px-5 sm:px-7 py-5 border-b border-slate-200 bg-gradient-to-r from-brand-500/10 to-transparent">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-brand-600">comanda #{sessao.id}</p>
            <h2 className="font-display text-5xl text-navy-900 leading-none mt-1">{sessao.mesaNome}</h2>
            {sessao.clienteNome && (
              <p className="text-xs text-brand-700 mt-1 font-semibold">{sessao.clienteNome}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">em aberto</p>
            <p className="font-mono text-sm text-slate-600 tabular">{elapsed(sessao.abertaEm)}</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-0">
        {/* ---- itens + ajustes ---- */}
        <div className="p-5 sm:p-7 border-b lg:border-b-0 lg:border-r border-slate-200">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.26em] text-slate-500 mb-3.5">consumo da sessão</h3>
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1 no-scrollbar">
            {pedidos.map((p) => (
              <div key={p.id} className="rounded-2xl bg-slate-100/50 border border-slate-200 p-3.5">
                <p className="text-[11px] font-bold text-slate-500 mb-1.5">
                  #{p.id} · {p.clienteNome}
                </p>
                {p.itens.map((i) => (
                  <div key={i.id} className="flex justify-between gap-3 text-[13px] text-slate-600 py-0.5">
                    <span className="leading-snug">
                      <b className="font-mono text-navy-900">{i.qtd}×</b> {i.nome}
                      {i.escolha && <span className="text-navy-700 text-[11px]"> · {i.escolha.nome}</span>}
                    </span>
                    <span className="font-mono text-slate-500">{BRL(i.totalUnit * i.qtd)}</span>
                  </div>
                ))}
              </div>
            ))}
            {pedidos.length === 0 && <p className="text-xs text-slate-500">sem pedidos registrados</p>}
          </div>

          {/* ajustes */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Ajuste label="desconto" valor={sessao.desconto} onChange={(v) => setDesconto(sessao.id, v)} tom="text-teal-600" />
            <Ajuste label="taxa / couvert" valor={sessao.taxa} onChange={(v) => setTaxa(sessao.id, v)} tom="text-amber-700" />
          </div>

          {/* resumo */}
          <div className="mt-5 space-y-1.5 rounded-2xl bg-slate-100 border border-slate-200 p-4 font-mono text-sm">
            <Linha label="Consumo" valor={BRL(consumo)} />
            <Linha label="Desconto" valor={`− ${BRL(sessao.desconto)}`} tom="text-teal-600" />
            <Linha label="Taxa" valor={`+ ${BRL(sessao.taxa)}`} tom="text-amber-700" />
            <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between items-baseline">
              <span className="text-slate-500 text-xs uppercase tracking-widest font-sans font-bold">total</span>
              <span className="font-display text-4xl text-gradient">{BRL(total)}</span>
            </div>
          </div>
        </div>

        {/* ---- pagamento ---- */}
        <div className="p-5 sm:p-7">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.26em] text-slate-500 mb-3.5 flex items-center gap-1.5">
            <HandCoins className="size-4 text-teal-600" /> recebimento
          </h3>

          {/* divisão */}
          <div className="rounded-2xl border border-slate-200 bg-slate-100/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-600">
                <Users className="size-4 text-navy-700" /> dividir a conta
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPessoas((p) => Math.max(1, p - 1))} className="btn-press grid place-items-center size-8 rounded-full bg-slate-100/70 border border-slate-200 text-slate-600 hover:text-navy-800 cursor-pointer">
                  <Minus className="size-3.5" />
                </button>
                <span className="w-12 text-center font-display text-3xl text-navy-900">{pessoas}</span>
                <button onClick={() => setPessoas((p) => Math.min(20, p + 1))} className="btn-press grid place-items-center size-8 rounded-full bg-slate-100/70 border border-slate-200 text-slate-600 hover:text-navy-800 cursor-pointer">
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>
            <button
              onClick={usarPorPessoa}
              className="btn-press mt-3 w-full h-11 rounded-xl border border-navy-700/40 bg-navy-700/10 text-navy-700 text-xs font-bold uppercase tracking-wider inline-flex items-center justify-center gap-2 cursor-pointer hover:bg-navy-700/15 transition-colors"
            >
              <Split className="size-4" /> usar valor/pessoa · {pessoas > 0 ? BRL(restante / pessoas) : "—"}
            </button>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-500">R$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0,00"
                  className="w-full h-12 rounded-xl bg-slate-100 border border-slate-200 pl-10 pr-3 font-mono text-base text-navy-900 focus:outline-none focus:border-brand-500/60 transition"
                />
              </div>
              <button
                onClick={() => setValor(restante.toFixed(2))}
                className="btn-press h-12 px-3.5 rounded-xl bg-slate-100/70 border border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:text-navy-800 cursor-pointer"
              >
                tudo
              </button>
            </div>

            {/* formas */}
            <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {FORMAS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setForma(f.id)}
                  className={cn(
                    "btn-press h-10 rounded-xl text-[10px] font-bold uppercase tracking-wide cursor-pointer border transition-all inline-flex items-center justify-center gap-1",
                    forma === f.id
                      ? "bg-gradient-to-br from-brand-500 to-teal-600 text-white border-transparent"
                      : "bg-slate-100/60 border-slate-200 text-slate-500 hover:text-navy-800"
                  )}
                >
                  {f.id === "pix" ? <QrCode className="size-3" /> : f.id === "dinheiro" ? <Banknote className="size-3" /> : <CreditCard className="size-3" />}
                  {f.label}
                </button>
              ))}
            </div>

            <Btn full className="mt-2.5" onClick={() => podeRegistrar && registrar(sessao.id, Number(valor), forma)} disabled={!podeRegistrar}>
              Registrar pagamento
            </Btn>
          </div>

          {/* pagamentos parciais */}
          <div className="mt-4">
            <p className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 mb-2">
              pagamentos <span className="font-mono normal-case tracking-normal text-slate-500">resta {BRL(restante)}</span>
            </p>
            <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1 no-scrollbar">
              <AnimatePresence initial={false}>
                {sessao.pagamentos.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-500">nada recebido ainda</p>
                )}
                {sessao.pagamentos.map((pg) => (
                  <motion.div
                    key={pg.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="flex items-center justify-between rounded-xl bg-teal-500/10 border border-teal-500/25 px-3.5 py-2"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-teal-700 uppercase tracking-wide">
                      <Check className="size-3.5 text-teal-600" /> {FORMAS.find((f) => f.id === pg.forma)?.label}
                    </span>
                    <span className="font-mono text-sm text-teal-700">{BRL(pg.valor)}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* PIX + fechar */}
          <div className="mt-4 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/10 to-transparent p-4">
            <div className="flex items-center gap-4">
              <div className="rounded-xl papel-qr p-2.5 shadow-lg shrink-0">
                {pixCodigo ? (
                  <QRCodeSVG value={pixCodigo} size={86} fgColor="#0a2540" level="M" />
                ) : (
                  <div className="size-[86px] rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-[9px] text-slate-500 text-center px-1">
                    Configure PIX_CHAVE no servidor
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-navy-900">PIX do restante · {BRL(restante)}</p>
                {pixAviso ? (
                  <p className="text-[11px] font-semibold text-amber-700 leading-snug mt-0.5">
                    {pixAviso}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 leading-snug mt-0.5">Mostre pro cliente ou copie o código.</p>
                )}
                <button onClick={copiarPix} className="btn-press mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-600 hover:text-brand-700 cursor-pointer">
                  {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copiado ? "copiado!" : "copiar código PIX"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4">
            {(sessao.pedidosPendentes != null && sessao.pedidosPendentes > 0) && (
            <p className="mb-2 text-center text-[11px] text-brand-600">
              {sessao.pedidosPendentes} pedido(s) ainda na cozinha/garçom — só fecha quando tudo estiver entregue.
            </p>
          )}
          {!fechando ? (
              <Btn
                full
                size="lg"
                variant="lime"
                onClick={() => setFechando(true)}
                disabled={total <= 0 || sessao.podeFechar === false || (sessao.pedidosPendentes != null && sessao.pedidosPendentes > 0)}
              >
                Fechar conta {restante > 0.004 ? `· quita ${BRL(restante)}` : "· já quitada"}
              </Btn>
            ) : (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-teal-500/40 bg-teal-500/10 p-4">
                <p className="text-sm font-bold text-navy-900">Fechar a {sessao.mesaNome}?</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {restante > 0.004
                    ? `O restante (${BRL(restante)}) será registrado em ${FORMAS.find((f) => f.id === forma)?.label} e a mesa fica livre.`
                    : "Conta já quitada — a mesa fica livre na hora."}
                </p>
                <div className="mt-3 flex gap-2">
                  <Btn full variant="lime" onClick={fechar}>
                    <Check className="size-4.5" /> Confirmar fechamento
                  </Btn>
                  <Btn variant="glass" onClick={() => setFechando(false)}>
                    <X className="size-4" />
                  </Btn>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Ajuste({ label, valor, onChange, tom }: { label: string; valor: number; onChange: (v: number) => void; tom: string }) {
  const [txt, setTxt] = useState(valor ? String(valor) : "");
  useEffect(() => setTxt(valor ? String(valor) : ""), [valor]);
  const aplicar = (d: number) => {
    const novo = Math.max(0, Math.round((valor + d) * 100) / 100);
    onChange(novo);
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-100/50 p-3">
      <p className={cn("text-[10px] font-bold uppercase tracking-[0.22em] mb-2", tom)}>{label}</p>
      <div className="flex items-center gap-1.5">
        <button onClick={() => aplicar(-1)} className="btn-press grid place-items-center size-8 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 hover:text-navy-800 cursor-pointer">
          <Minus className="size-3.5" />
        </button>
        <input
          type="number"
          value={txt}
          onChange={(e) => {
            setTxt(e.target.value);
            const n = Number(e.target.value);
            if (!Number.isNaN(n) && n >= 0) onChange(n);
          }}
          className="btn-press w-full h-8 rounded-lg bg-slate-100 border border-slate-200 text-center font-mono text-sm text-navy-900 focus:outline-none focus:border-brand-500/50"
        />
        <button onClick={() => aplicar(1)} className="btn-press grid place-items-center size-8 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 hover:text-navy-800 cursor-pointer">
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function Linha({ label, valor, tom }: { label: string; valor: string; tom?: string }) {
  return (
    <div className="flex justify-between text-slate-500">
      <span className="text-xs font-sans uppercase tracking-wider font-semibold">{label}</span>
      <span className={tom}>{valor}</span>
    </div>
  );
}

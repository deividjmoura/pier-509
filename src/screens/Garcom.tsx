import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, CheckCheck, ConciergeBell, Footprints, Printer, Sparkles, Timer } from "lucide-react";
import { OpsShell, useAnuncios } from "../components/OpsShell";
import { Badge, Btn } from "../components/ui";
import { ir, useAgora } from "../router";

import type { Pedido } from "../lib/types";
import { usePub } from "../store/usePub";
import { connectEvents } from "../lib/api";
import { elapsed } from "../lib/utils";
import { imprimirComandaGarcom } from "../lib/print";

export default function Garcom({ token }: { token: string }) {
  useAnuncios("garcom");
  useAgora(1000);

  const pedidos = usePub((s) => s.pedidos);
  const hydrateGarcom = usePub((s) => s.hydrateGarcom);
  useEffect(() => {
    if (!token) return;
    void hydrateGarcom(token);
    const t = setInterval(() => void hydrateGarcom(token), 8000);
    const off = connectEvents(() => void hydrateGarcom(token), { garcom: token });
    return () => {
      clearInterval(t);
      off();
    };
  }, [token, hydrateGarcom]);

  const entregar = usePub((s) => s.entregarPedido);
  const lastError = usePub((s) => s.lastError);

  const prontos = pedidos
    .filter((p) => p.status !== "entregue" && p.itens.some((i) => i.status === "concluido"))
    .sort((a, b) => a.criadoEm - b.criadoEm);
  const entregues = pedidos
    .filter((p) => p.status === "entregue")
    .sort((a, b) => b.criadoEm - a.criadoEm)
    .slice(0, 6);

  if (!token) {
    ir("/");
    return null;
  }

  const tokenCurto = token.length > 8 ? token.slice(0, 8) + "…" : token;

  const extras = (
    <div className="flex items-center gap-2">
      <Badge tone="zinc">link · {tokenCurto}</Badge>
      <Badge tone={prontos.length ? "amber" : "zinc"} pulse={prontos.length > 0}>
        {prontos.length} pra entregar
      </Badge>
    </div>
  );

  return (
    <OpsShell ativo="garcom" kicker="operação · garçom" titulo={<>Fila do <span className="text-gradient">garçom</span></>} extra={extras}>
      {lastError && (
        <p className="mb-4 rounded-2xl border border-rose-400/40 bg-rose-600/10 px-4 py-3 text-sm text-rose-700">
          {lastError}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* prontos */}
        <section className="lg:col-span-2">
          <AnimatePresence mode="sync">
            {prontos.length === 0 ? (
              <motion.div
                key="vazio"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="grid place-items-center rounded-3xl border border-dashed border-slate-200 py-24 text-center"
              >
                <div>
                  <motion.div animate={{ rotate: [0, 6, -6, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
                    <ConciergeBell className="size-14 text-slate-400 mx-auto" />
                  </motion.div>
                  <h3 className="font-display text-4xl text-navy-900 mt-4">Nada na bancada</h3>
                  <p className="text-sm text-slate-500 mt-1.5">
                    Quando a cozinha concluir, sua voz de rádio anuncia o número da mesa.
                  </p>
                </div>
              </motion.div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {prontos.map((p) => (
                  <CardPronto
                    key={p.id}
                    pedido={p}
                    onEntregar={(ids) => entregar(p.id, token, ids)}
                  />
                ))}
              </div>
            )}
          </AnimatePresence>
        </section>

        {/* entregues */}
        <aside className="glass rounded-3xl p-5 h-fit">
          <h3 className="font-display text-3xl text-navy-900 flex items-center gap-2">
            <CheckCheck className="size-5 text-teal-600" /> Entregues
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 mb-4">últimas corridas do salão</p>
          <div className="space-y-2.5">
            <AnimatePresence initial={false}>
              {entregues.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">
                  nenhuma entrega ainda
                </p>
              )}
              {entregues.map((p) => (
                <motion.div
                  key={p.id}
                  layout
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3 rounded-2xl bg-slate-100/60 border border-slate-200 p-3"
                >
                  <span className="grid place-items-center size-10 rounded-xl bg-teal-500/10 border border-teal-500/30 font-display text-2xl text-teal-600 leading-none pt-0.5">
                    {p.mesaNome.replace("Mesa ", "")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-navy-900 truncate">
                      {p.clienteNome} · {p.itens.reduce((a, i) => a + i.qtd, 0)} itens
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono tabular">há {elapsed(p.criadoEm)}</p>
                  </div>
                  <CheckCheck className="size-4 text-teal-600 shrink-0" />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </aside>
      </div>
    </OpsShell>
  );
}

function labelItemStatus(s?: string) {
  switch (s) {
    case "recebido":
      return { t: "na fila", tone: "text-slate-500" };
    case "em_producao":
      return { t: "preparando", tone: "text-navy-700" };
    case "concluido":
      return { t: "pronto", tone: "text-teal-600" };
    case "entregue":
      return { t: "entregue", tone: "text-slate-500" };
    default:
      return { t: s || "—", tone: "text-slate-500" };
  }
}

function CardPronto({
  pedido,
  onEntregar,
}: {
  pedido: Pedido;
  onEntregar: (itemIds?: number[]) => void;
}) {
  const esfriando = Date.now() - pedido.criadoEm > 1000 * 60 * 25;
  const prontos = pedido.itens.filter((i) => i.status === "concluido");
  const aindaProducao = pedido.itens.filter(
    (i) => i.status === "recebido" || i.status === "em_producao"
  );
  const idsProntos = prontos
    .map((i) => Number(i.id))
    .filter((n) => Number.isFinite(n) && n > 0);

  return (
    <motion.article
      layout
      layoutId={`garcom-${pedido.id}`}
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="relative overflow-hidden rounded-3xl glass-deep noise p-6 text-center"
    >
      <div className="glow-orb absolute -top-16 -right-16 size-44 bg-brand-500/15" />
      <Badge tone={esfriando ? "rose" : "amber"} pulse>
        {esfriando ? "esfriando!" : prontos.length ? "pronto p/ entrega" : "aguardando"}
      </Badge>

      <p className="mt-3 text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500">levar para a</p>
      <motion.p
        key={pedido.id}
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 12 }}
        className="font-display leading-[0.9] text-[clamp(3.5rem,22vw,8.5rem)] text-gradient drop-shadow-[0_0_40px_rgba(255,150,20,0.25)]"
      >
        {pedido.mesaNome.replace("Mesa ", "")}
      </motion.p>

      <p className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-600">
        <span className="inline-flex items-center rounded-full bg-brand-500/10 border border-brand-500/40 px-3 py-1 text-sm font-bold text-brand-700">
          {pedido.clienteNome}
        </span>
        <span className="font-mono text-xs text-slate-500">pedido #{pedido.id}</span>
      </p>

      <ul className="mx-auto mt-4 max-w-xs space-y-1.5 rounded-2xl bg-slate-100 border border-slate-200 p-3.5 text-left">
        {pedido.itens.map((i) => {
          const st = labelItemStatus(i.status);
          return (
            <li key={i.id} className="text-[13px] text-slate-700 leading-snug flex items-start justify-between gap-2">
              <span>
                <b className="font-mono text-brand-600">{i.qtd}×</b> {i.nome}
                {i.setor === "bar" && (
                  <span className="ml-1 text-[9px] uppercase tracking-wider text-violet-700">bar</span>
                )}
                {i.removidos.length > 0 && (
                  <span className="block text-[11px] text-rose-600">sem {i.removidos.join(", ")}</span>
                )}
              </span>
              <span className={"shrink-0 text-[10px] font-bold uppercase tracking-wider " + st.tone}>
                {st.t}
              </span>
            </li>
          );
        })}
      </ul>

      {aindaProducao.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          {aindaProducao.length} item(ns) ainda na produção — pode levar o que já está pronto
        </p>
      )}

      <p className="mt-3 flex items-center justify-center gap-1.5 font-mono text-xs text-slate-500 tabular">
        <Timer className="size-3.5" /> há {elapsed(pedido.criadoEm)}
      </p>

      <div className="mt-4 space-y-2">
        <Btn full size="sm" variant="outline" onClick={() => imprimirComandaGarcom(pedido)}>
          <Printer className="size-4" /> Imprimir cupom
        </Btn>
        {idsProntos.length > 0 && (
          <Btn full size="lg" variant="lime" onClick={() => onEntregar(idsProntos)}>
            <Footprints className="size-5" />
            {aindaProducao.length > 0
              ? `Levar prontos (${idsProntos.length})`
              : "Levei na mesa!"}
          </Btn>
        )}
        {idsProntos.length > 1 && aindaProducao.length === 0 && (
          <p className="text-[10px] text-slate-500">entrega completa deste pedido</p>
        )}
      </div>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
        <Sparkles className="size-3" /> entrega parcial liberada — bar e cozinha no mesmo pedido
        <BellRing className="size-3" />
      </p>
    </motion.article>
  );
}

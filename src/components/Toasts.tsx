import { AnimatePresence, motion } from "framer-motion";
import { BellRing, CheckCheck, ChefHat, QrCode, Receipt, UtensilsCrossed, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePub } from "../store/usePub";
import type { EventoTipo } from "../lib/types";
import { hora } from "../lib/utils";

// Mapa precisa cobrir todo EventoTipo — o TS acusa erro em build se faltar
// uma chave, mas o `npm run build` (vite/esbuild) não faz checagem de tipos,
// então um evento sem ícone só quebra em produção quando disparado
// ("Element type is invalid"). Foi o caso de "pedido-cancelado" nesta branch.
const ICONES: Record<EventoTipo, typeof BellRing> = {
  "pedido-novo": Receipt,
  "pedido-aceito": ChefHat,
  "pedido-pronto": UtensilsCrossed,
  "pedido-entregue": CheckCheck,
  "pedido-cancelado": XCircle,
  "pix-avisado": QrCode,
  "sessao-fechada": BellRing,
};

/* Toasts globais alimentados pelo barramento de eventos (simula o SSE do original) */
export function Toasts() {
  const eventos = usePub((s) => s.eventos);
  const [pilha, setPilha] = useState<{ id: number; texto: string; tipo: EventoTipo; em: number }[]>([]);
  const visto = useRef(0);

  useEffect(() => {
    const novos = eventos.filter((e) => e.seq > visto.current);
    if (!novos.length) return;
    visto.current = novos[novos.length - 1].seq;
    const agora = Date.now();
    setPilha((p) => [
      ...p,
      ...novos.slice(-3).map((n) => ({ id: n.seq, texto: n.texto, tipo: n.tipo, em: agora })),
    ].slice(-4));
  }, [eventos]);

  useEffect(() => {
    if (!pilha.length) return;
    const t = setTimeout(() => setPilha((p) => p.slice(1)), 4200);
    return () => clearTimeout(t);
  }, [pilha]);

  return (
    <div className="fixed top-4 inset-x-0 z-100 flex flex-col items-center gap-2 px-4 pointer-events-none">
      <AnimatePresence>
        {pilha.map((t) => {
          const Icon = ICONES[t.tipo];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ y: -24, opacity: 0, scale: 0.94 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -18, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className="pointer-events-auto flex items-center gap-3 rounded-2xl glass-deep noise pl-3 pr-4 py-2.5 shadow-2xl max-w-sm w-full"
            >
              <span className="grid place-items-center size-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-teal-600/15 border border-brand-500/30 text-brand-600">
                <Icon className="size-4.5" />
              </span>
              <p className="flex-1 text-[13px] font-medium text-slate-800 leading-tight">{t.texto}</p>
              <span className="text-[10px] font-mono text-slate-500">{hora(t.em)}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

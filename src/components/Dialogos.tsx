/**
 * Diálogos do app (aviso e confirmação) no lugar de alert()/confirm() nativos.
 *
 * Por quê: alert() nativo trava a thread, ignora o tema, aparece com a URL do
 * site no celular do cliente e é bloqueado em alguns navegadores embutidos
 * (Instagram/WhatsApp). Aqui o visual é o mesmo do resto do sistema.
 *
 * Uso:
 *   avisar("Não foi possível salvar");
 *   if (!(await confirmar("Excluir o produto?"))) return;
 */
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Btn, Selo } from "./ui";

type Tipo = "aviso" | "confirmacao";

interface Pedido {
  id: number;
  tipo: Tipo;
  titulo: string;
  texto: ReactNode;
  perigo: boolean;
  resolver?: (v: boolean) => void;
}

let seq = 0;
let fila: Pedido[] = [];
const ouvintes = new Set<(p: Pedido[]) => void>();

function publicar() {
  for (const fn of ouvintes) fn(fila);
}

/** Palavras que indicam ação destrutiva → botão de confirmar em vermelho. */
const PERIGO = /(excluir|apagar|remover|cancelar|fechar a conta|purge|zerar|limpar)/i;

export function avisar(texto: ReactNode, titulo = "Aviso do cais") {
  fila = [...fila, { id: ++seq, tipo: "aviso", titulo, texto, perigo: false }];
  publicar();
}

export function confirmar(
  texto: ReactNode,
  opcoes: { titulo?: string; perigo?: boolean } = {}
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const perigo = opcoes.perigo ?? PERIGO.test(typeof texto === "string" ? texto : "");
    fila = [
      ...fila,
      {
        id: ++seq,
        tipo: "confirmacao",
        titulo: opcoes.titulo || (perigo ? "Tem certeza, marujo?" : "Confirmar"),
        texto,
        perigo,
        resolver: resolve,
      },
    ];
    publicar();
  });
}

export function Dialogos() {
  const [atual, setAtual] = useState<Pedido | null>(null);

  useEffect(() => {
    const fn = (p: Pedido[]) => setAtual(p[0] || null);
    ouvintes.add(fn);
    fn(fila);
    return () => {
      ouvintes.delete(fn);
    };
  }, []);

  const fechar = (resposta: boolean) => {
    if (!atual) return;
    fila = fila.filter((p) => p.id !== atual.id);
    publicar();
    atual.resolver?.(resposta);
  };

  useEffect(() => {
    if (!atual) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar(atual.tipo === "confirmacao" ? false : true);
      if (e.key === "Enter" && atual.tipo === "confirmacao") fechar(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual]);

  return (
    <AnimatePresence>
      {atual && (
        <motion.div
          key={atual.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-200 grid place-items-center p-4"
          onClick={() => fechar(atual.tipo !== "confirmacao")}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <motion.div
            initial={{ y: 24, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative glass-deep borda-corda rounded-3xl w-full max-w-sm p-5 pt-6 text-center"
          >
            <div className="flex justify-center">
              <span
                className={
                  "grid place-items-center size-12 rounded-full border " +
                  (atual.perigo
                    ? "bg-rose-600/10 border-rose-500/40 text-rose-600"
                    : "bg-brand-500/10 border-brand-500/40 text-brand-600")
                }
              >
                {atual.perigo ? <AlertTriangle className="size-5" /> : <Info className="size-5" />}
              </span>
            </div>
            <h3 className="font-display text-2xl text-navy-900 mt-3">{atual.titulo}</h3>
            <div className="mt-2 text-sm text-slate-600 leading-relaxed break-words">{atual.texto}</div>

            <div className="mt-5 flex gap-2">
              {atual.tipo === "confirmacao" ? (
                <>
                  <Btn variant="ghost" className="flex-1" onClick={() => fechar(false)}>
                    <X className="size-4" /> Cancelar
                  </Btn>
                  <Btn
                    variant={atual.perigo ? "danger" : "brand"}
                    className="flex-1"
                    onClick={() => fechar(true)}
                  >
                    <Check className="size-4" /> Confirmar
                  </Btn>
                </>
              ) : (
                <Btn className="flex-1" onClick={() => fechar(true)}>
                  Entendi
                </Btn>
              )}
            </div>

            <div className="mt-4 flex items-center justify-center gap-2 opacity-60">
              <Selo tamanho={20} />
              <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Pier 509</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

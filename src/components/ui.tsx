import { motion, AnimatePresence } from "framer-motion";
import { X, Flame, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { cn } from "../utils/cn";
import { alternarTema, temaAtual, EVENTO_TEMA, type Tema } from "../lib/tema";
import { MARCA, SELO } from "../lib/marca";

/* ---------- Selo e assinatura da marca ----------
 * O selo é um PNG circular com fundo transparente (funciona nos dois temas).
 * A "assinatura" abaixo é texto, então nunca fica pixelada em telas retina. */

export function Selo({
  tamanho = 40,
  className,
}: {
  tamanho?: number;
  className?: string;
}) {
  const onBroken = (e: SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    if (el.dataset.fallback === "1") return;
    el.dataset.fallback = "1";
    el.src = SELO.png256;
  };
  return (
    <img
      src={SELO.webp256}
      alt={`Selo ${MARCA.nomeCaixaAlta}`}
      width={tamanho}
      height={tamanho}
      draggable={false}
      onError={onBroken}
      className={cn("selo-marca rounded-full object-cover select-none", className)}
      style={{ width: tamanho, height: tamanho }}
    />
  );
}

export function Logo({
  size = "md",
  somenteSelo = false,
}: {
  size?: "sm" | "md" | "lg";
  somenteSelo?: boolean;
}) {
  const selo = size === "sm" ? 34 : size === "lg" ? 74 : 46;
  const nome =
    size === "sm" ? "text-xl" : size === "lg" ? "text-5xl sm:text-6xl" : "text-3xl";
  const sub =
    size === "sm" ? "text-[8px]" : size === "lg" ? "text-xs" : "text-[9px]";

  return (
    <span className="inline-flex items-center gap-2.5 select-none min-w-0">
      <Selo tamanho={selo} className="shrink-0" />
      {!somenteSelo && (
        <span className="flex flex-col items-start leading-none min-w-0">
          <span className={cn("font-display text-ouro whitespace-nowrap", nome)}>
            {MARCA.nomeCaixaAlta}
          </span>
          <span
            className={cn(
              "font-bold uppercase tracking-[0.42em] text-slate-500 whitespace-nowrap mt-0.5",
              sub
            )}
          >
            Lanchonete &amp; Pub
          </span>
        </span>
      )}
    </span>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const [tema, setTema] = useState<Tema>(() => temaAtual());
  useEffect(() => {
    const fn = (e: Event) => setTema((e as CustomEvent<Tema>).detail);
    window.addEventListener(EVENTO_TEMA, fn);
    return () => window.removeEventListener(EVENTO_TEMA, fn);
  }, []);
  const rotulo = tema === "claro" ? "Acender as luzes (tema escuro)" : "Acender o lampião? (tema claro)";
  return (
    <button
      type="button"
      onClick={alternarTema}
      title={rotulo}
      aria-label={rotulo}
      className={cn(
        "btn-press grid place-items-center size-10 rounded-full border cursor-pointer transition-colors",
        "border-slate-200 bg-slate-100/70 text-slate-600 hover:text-brand-600 hover:border-brand-500/50",
        className
      )}
    >
      {tema === "claro" ? <Moon className="size-4.5" /> : <Sun className="size-4.5" />}
    </button>
  );
}

/* ---------- Fundo temático ----------
 * variante:
 *   "cliente"  → doodles piratas (página da mesa)
 *   "admin"    → mapa do tesouro (gestão)
 *   "taverna"  → brilhos suaves (cozinha/bar/caixa — foco no conteúdo) */

export function FundoPirata({
  variante = "taverna",
}: {
  variante?: "cliente" | "admin" | "taverna";
}) {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {variante === "cliente" && <div className="absolute inset-0 fundo-doodles" />}
      {variante === "admin" && <div className="absolute inset-0 fundo-mapa" />}
      <div className="glow-orb absolute -top-40 left-[12%] size-[32rem] bg-brand-500/12" />
      <div className="glow-orb absolute bottom-[-12rem] right-[-6rem] size-[26rem] bg-navy-500/10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(217,166,63,0.10),transparent_64%)]" />
    </div>
  );
}

/** Tela de espera com a marca — usada nas guardas de acesso e hydrate inicial. */
export function Carregando({ texto = "Içando as velas…" }: { texto?: string }) {
  return (
    <div className="min-h-dvh grid place-items-center p-6 text-center">
      <div className="flex flex-col items-center">
        <Selo tamanho={78} className="animate-pulse" />
        <p className="font-display text-3xl text-navy-900 mt-5">{texto}</p>
        <p className="text-slate-500 mt-1.5 text-sm">Falando com o servidor do cais…</p>
      </div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "brand",
  size = "md",
  className,
  disabled,
  full,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "brand" | "ghost" | "outline" | "danger" | "lime" | "glass";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
  full?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <motion.button
      type={type}
      title={title}
      whileTap={{ scale: 0.96 }}
      whileHover={disabled ? undefined : { y: -1 }}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "btn-press inline-flex items-center justify-center gap-2 rounded-2xl font-semibold select-none cursor-pointer",
        "transition-colors disabled:opacity-35 disabled:pointer-events-none",
        size === "sm" && "h-9 px-3.5 text-xs",
        size === "md" && "h-11 px-5 text-sm",
        size === "lg" && "h-13 px-7 text-base",
        full && "w-full",
        variant === "brand" &&
          "bg-gradient-to-br from-brand-400 to-brand-600 text-[#2a1f08] shadow-[0_10px_30px_-8px_rgba(169,121,31,0.55)] hover:shadow-[0_14px_38px_-6px_rgba(169,121,31,0.7)] border border-brand-700/40",
        variant === "lime" &&
          "bg-gradient-to-br from-teal-400 to-teal-600 text-[#04241c] shadow-[0_10px_30px_-8px_rgba(20,107,85,0.5)] border border-teal-700/30",
        variant === "ghost" && "bg-slate-100/70 text-slate-700 hover:bg-slate-100 border border-slate-200",
        variant === "glass" && "glass text-slate-800 hover:border-brand-500/50",
        variant === "outline" && "border border-brand-500/50 text-brand-600 hover:bg-brand-500/10",
        variant === "danger" && "bg-rose-600/10 text-rose-600 border border-rose-500/40 hover:bg-rose-600/10",
        className
      )}
    >
      {children}
    </motion.button>
  );
}

export function Badge({
  children,
  tone = "amber",
  className,
  pulse,
}: {
  children: ReactNode;
  tone?: "amber" | "lime" | "sky" | "rose" | "zinc" | "violet";
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
        tone === "amber" && "bg-amber-500/10 text-amber-700 border border-amber-500/30",
        tone === "lime" && "bg-teal-500/10 text-teal-700 border border-teal-500/30",
        tone === "sky" && "bg-navy-700/10 text-navy-700 border border-navy-700/25",
        tone === "rose" && "bg-rose-600/10 text-rose-600 border border-rose-400/40",
        tone === "violet" && "bg-violet-500/10 text-violet-700 border border-violet-500/30",
        tone === "zinc" && "bg-slate-100/80 text-slate-600 border border-slate-200",
        className
      )}
    >
      {pulse && <span className="size-1.5 rounded-full bg-current animate-pulse-soft" />}
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  children,
  wide,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeOnBackdrop?: boolean;
}) {
  /* ESC fecha — em telas de operação (cozinha/caixa) é o atalho que a equipe usa */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-90 flex items-end sm:items-center justify-center sm:p-6"
          onClick={() => {
            if (closeOnBackdrop) onClose();
          }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 50, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "relative glass-deep borda-corda noise rounded-t-4xl sm:rounded-4xl w-full max-h-[92dvh] overflow-y-auto no-scrollbar",
              wide ? "sm:max-w-2xl" : "sm:max-w-md"
            )}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="btn-press absolute top-4 right-4 z-10 grid place-items-center size-10 rounded-full bg-slate-100 border border-slate-200 text-navy-900 hover:bg-slate-200 cursor-pointer"
            >
              <X className="size-4.5" />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Qtd({
  valor,
  onChange,
  size = "md",
}: {
  valor: number;
  onChange: (v: number) => void;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full bg-slate-100 border border-slate-200",
        size === "sm" ? "h-8" : "h-10"
      )}
    >
      <button
        type="button"
        aria-label="Diminuir quantidade"
        className="btn-press h-full aspect-square grid place-items-center text-slate-600 hover:text-brand-600 cursor-pointer text-lg font-bold"
        onClick={() => onChange(Math.max(1, valor - 1))}
      >
        −
      </button>
      <span className={cn("tabular font-mono font-semibold text-navy-900", size === "sm" ? "w-6 text-xs" : "w-8 text-sm", "text-center")}>
        {valor}
      </span>
      <button
        type="button"
        aria-label="Aumentar quantidade"
        className="btn-press h-full aspect-square grid place-items-center text-slate-600 hover:text-brand-600 cursor-pointer text-lg font-bold"
        onClick={() => onChange(valor + 1)}
      >
        +
      </button>
    </div>
  );
}

export function LivePill({ label = "ao vivo" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 border border-teal-500/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-teal-600">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-teal-500 opacity-75 animate-ping" />
        <span className="relative inline-flex size-1.5 rounded-full bg-teal-500" />
      </span>
      {label}
    </span>
  );
}

export function Secao({ kicker, titulo, right }: { kicker: string; titulo: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.28em] text-brand-600">
          <Flame className="size-3.5" /> {kicker}
        </p>
        <h2 className="font-display text-4xl sm:text-5xl leading-none mt-1 text-navy-900">{titulo}</h2>
      </div>
      {right}
    </div>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  className,
  prefix,
  autoFocus,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  prefix?: string;
  autoFocus?: boolean;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email";
}) {
  return (
    <div className={cn("relative", className)}>
      {prefix && (
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">{prefix}</span>
      )}
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full h-12 rounded-2xl bg-slate-100 border border-slate-200 text-sm text-navy-900 placeholder:text-slate-400",
          "focus:outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 transition",
          prefix ? "pl-11 pr-4" : "px-4"
        )}
      />
    </div>
  );
}

/** Rodapé padrão do cliente: marca + Instagram + aviso. */
export function RodapeCliente({ className }: { className?: string }) {
  return (
    <footer className={cn("px-4 sm:px-6 pb-6", className)}>
      <div className="divisor-onda mb-4" />
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
        <div className="flex items-center gap-2.5">
          <Selo tamanho={30} />
          <div>
            <p className="font-display text-lg text-ouro leading-none">{MARCA.nomeCaixaAlta}</p>
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">{MARCA.bairro}</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">{MARCA.rodape}</p>
        <a
          href={MARCA.instagramUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 underline decoration-dotted underline-offset-4"
        >
          {MARCA.instagram}
        </a>
      </div>
    </footer>
  );
}

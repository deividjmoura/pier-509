import { motion } from "framer-motion";
import { ChefHat, House, LogOut, Volume2, VolumeX, Wallet, LayoutGrid, Wine } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { usePub } from "../store/usePub";
import { ir } from "../router";
import { cn } from "../utils/cn";
import { FundoPirata, LivePill, Logo, Selo, ThemeToggle } from "./ui";
import { audioMudo, beepAlerta, beepDuplo, falar, setMudo } from "../lib/sonus";
import { FRASES_GARCOM } from "../lib/data";
import { MARCA } from "../lib/marca";

/** Nav por papel: admin vê tudo (exceto link fixo de garçom — usa Admin → Garçons). */
const NAV_ALL = [
  { id: "cozinha", label: "Cozinha", icon: ChefHat, to: "/cozinha", roles: ["admin", "cozinha"] as const },
  { id: "bar", label: "Bar", icon: Wine, to: "/bar", roles: ["admin", "bar"] as const },
  { id: "caixa", label: "Caixa", icon: Wallet, to: "/caixa", roles: ["admin", "caixa"] as const },
  { id: "admin", label: "Comando", icon: LayoutGrid, to: "/admin", roles: ["admin"] as const },
];

/* Anúncios por papel — reproduz o comportamento dos alertas de voz do projeto:
   · Cozinha: pedido novo → mesa + cliente
   · Garçom: pedido pronto → nº da mesa (tom leve)
   · Caixa: pix informado / sessão fechada                          */
export function useAnuncios(papel: "cozinha" | "bar" | "garcom" | "caixa") {
  const eventos = usePub((s) => s.eventos);
  const visto = useRef(0);
  useEffect(() => {
    const novos = eventos.filter((e) => e.seq > visto.current);
    if (!novos.length) return;
    visto.current = Math.max(...novos.map((e) => e.seq));
    if (audioMudo()) return;
    for (const ev of novos) {
      const mesaNum = (ev.mesaNome || "").replace(/\D/g, "") || (ev.mesaNome || "").trim();
      const cliente = (ev.texto || "").replace(/^Pronto · /i, "").replace(/^Novo pedido · /i, "").trim();
      if ((papel === "cozinha" || papel === "bar") && ev.tipo === "pedido-novo") {
        beepAlerta();
        const quem = cliente && cliente !== "Cliente" ? cliente : "";
        const mesa = mesaNum ? `mesa ${mesaNum}` : ev.mesaNome || "nova mesa";
        falar(quem ? `Pedido novo! ${mesa}, ${quem}` : `Pedido novo! ${mesa}`);
      }
      if (papel === "garcom" && ev.tipo === "pedido-pronto") {
        beepDuplo();
        const mesa = mesaNum || ev.mesaNome || "";
        if (mesa) {
          const frase = FRASES_GARCOM[Math.floor(Math.random() * FRASES_GARCOM.length)];
          falar(frase(String(mesaNum || mesa).replace(/\D/g, "") || String(mesa)), { rate: 1.06, pitch: 1.05 });
        } else {
          falar("Pedido pronto na bancada!");
        }
      }
      if (papel === "caixa" && ev.tipo === "pix-avisado") {
        beepDuplo();
        const mesa = mesaNum ? `Mesa ${mesaNum}` : "Uma mesa";
        falar(`Aviso de PIX! ${mesa} disse que pagou.`);
      }
    }
  }, [eventos, papel]);
}

export function OpsShell({
  ativo,
  children,
  titulo,
  kicker,
  extra,
  fundo = "taverna",
}: {
  ativo: string;
  children: ReactNode;
  titulo: ReactNode;
  kicker: string;
  extra?: ReactNode;
  fundo?: "taverna" | "admin";
}) {
  const somLigado = usePub((s) => s.somLigado);
  const toggleSom = usePub((s) => s.toggleSom);
  const logout = usePub((s) => s.logout);
  const auth = usePub((s) => s.auth);
  const role = auth?.role || null;
  /* sem role (ex.: garçom por token) → sem menu de áreas; cada papel só vê o que pode */
  const nav = role
    ? NAV_ALL.filter((n) => (n.roles as readonly string[]).includes(role))
    : [];

  useEffect(() => {
    setMudo(!somLigado);
  }, [somLigado]);

  return (
    <div className="relative min-h-dvh flex flex-col">
      <FundoPirata variante={fundo} />

      {/* header — tabuada de madeira */}
      <header className="sticky top-0 z-50 border-b-2 border-brand-700/40 placa-madeira">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 h-16 sm:h-18 flex items-center gap-1.5 sm:gap-3 min-w-0">
          <button
            type="button"
            aria-label={`Início · ${MARCA.nomeCaixaAlta}`}
            onClick={() => {
              if (role === "admin") ir("/admin");
              else if (role === "cozinha") ir("/cozinha");
              else if (role === "bar") ir("/bar");
              else if (role === "caixa") ir("/caixa");
              else ir("/");
            }}
            className="cursor-pointer shrink-0"
          >
            <Logo size="sm" />
          </button>
          <span className="hidden md:block h-7 w-px bg-[#f6e3bb]/25" />
          <p className="hidden md:flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-[#f6e3bb]/70">
            {kicker} <LivePill />
          </p>

          <div className="flex-1 min-w-0" />

          <nav className="flex items-center gap-0.5 sm:gap-1 rounded-full bg-black/25 border border-[#f6e3bb]/20 p-0.5 sm:p-1 overflow-x-auto no-scrollbar max-w-[55vw] sm:max-w-none shrink">
            {nav.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => ir(n.to)}
                className={cn(
                  "btn-press relative flex items-center gap-1.5 rounded-full px-3 sm:px-3.5 h-9 text-xs font-semibold cursor-pointer transition-colors",
                  ativo === n.id ? "text-[#2a1f08]" : "text-[#f6e3bb]/75 hover:text-[#f6e3bb]"
                )}
              >
                {ativo === n.id && (
                  <motion.span
                    layoutId="ops-nav"
                    className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-400 to-brand-600"
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  />
                )}
                <n.icon className="relative z-10 size-4" />
                <span className="relative z-10 hidden md:inline">{n.label}</span>
              </button>
            ))}
          </nav>

          <ThemeToggle className="border-[#f6e3bb]/25 bg-black/25 text-[#f6e3bb] hover:text-white" />
          <button
            type="button"
            onClick={toggleSom}
            title={somLigado ? "Silenciar alertas de voz" : "Ativar alertas de voz"}
            aria-label={somLigado ? "Silenciar alertas de voz" : "Ativar alertas de voz"}
            className={cn(
              "btn-press grid place-items-center size-10 rounded-full border cursor-pointer transition-colors",
              somLigado
                ? "bg-brand-500/25 border-brand-400/50 text-[#f6dd9c]"
                : "bg-black/25 border-[#f6e3bb]/25 text-[#f6e3bb]/70"
            )}
          >
            {somLigado ? <Volume2 className="size-4.5" /> : <VolumeX className="size-4.5" />}
          </button>
          <button
            type="button"
            onClick={() => {
              ir("/");
            }}
            title="Início"
            aria-label="Início"
            className="btn-press hidden sm:grid place-items-center size-10 rounded-full bg-black/25 border border-[#f6e3bb]/25 text-[#f6e3bb]/80 hover:text-white cursor-pointer"
          >
            <House className="size-4.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              logout();
              ir("/login");
            }}
            title="Sair"
            aria-label="Sair"
            className="btn-press hidden sm:grid place-items-center size-10 rounded-full bg-black/25 border border-[#f6e3bb]/25 text-[#f6e3bb]/80 hover:text-rose-400 cursor-pointer"
          >
            <LogOut className="size-4.5" />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-10 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6 sm:mb-8">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-brand-600">{kicker}</p>
            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.95] text-navy-900 mt-1 break-words">
              {titulo}
            </h1>
          </div>
          {extra}
        </div>
        {children}
      </main>

      <footer className="mt-auto border-t border-slate-200/70 px-4 sm:px-6 py-5">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center gap-2.5">
            <Selo tamanho={26} />
            <p className="font-display text-lg text-ouro leading-none">{MARCA.nomeCaixaAlta}</p>
          </div>
          <p className="text-[11px] text-slate-500">{MARCA.assinatura}</p>
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
    </div>
  );
}

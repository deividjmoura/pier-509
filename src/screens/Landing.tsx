import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, ChefHat, ConciergeBell, QrCode, Smartphone,
  Split, Wallet, Boxes, ChartNoAxesColumn, UtensilsCrossed, Zap, Anchor,
} from "lucide-react";
import { Badge, FundoPirata, LivePill, Logo, Secao, Selo, ThemeToggle } from "../components/ui";
import { ir } from "../router";
import { usePub, totalSessao } from "../store/usePub";
import { BRL } from "../lib/utils";
import { MARCA } from "../lib/marca";

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
};

const FLUXO = [
  { icon: Smartphone, passo: "01", titulo: "Cliente", texto: "Escaneia o QR da mesa, monta o pedido no celular e personaliza tudo — sem app, sem fila.", tom: "text-sky-700" },
  { icon: ChefHat, passo: "02", titulo: "Cozinha", texto: "Recebe na hora com alerta de voz: mesa + cliente. Aceita, produz e marca como pronto.", tom: "text-brand-600" },
  { icon: ConciergeBell, passo: "03", titulo: "Garçom", texto: "Voz leve anunciando o nº da mesa. Entrega e confirma com um toque.", tom: "text-violet-700" },
  { icon: Wallet, passo: "04", titulo: "Caixa", texto: "Fecha a comanda acumulativa, divide a conta, aplica desconto e confirma o PIX.", tom: "text-teal-600" },
];

const RECURSOS = [
  { icon: QrCode, titulo: "Comanda acumulativa", texto: "Uma conta por visita: a mesa pede várias vezes, o caixa fecha uma vez só." },
  { icon: Split, titulo: "Divisão de conta", texto: "N pessoas, valor por pessoa, pagamentos parciais com badge pago/restante." },
  { icon: Zap, titulo: "PIX na mesa", texto: "QR com valor, copia-e-cola e o botão “Já paguei” que avisa o caixa na hora." },
  { icon: Boxes, titulo: "Estoque vivo", texto: "Baixa automática a cada pedido e alerta quando um item está acabando." },
  { icon: ChartNoAxesColumn, titulo: "Painel do dia", texto: "Faturamento, ticket médio e os campeões de venda em tempo real." },
  { icon: UtensilsCrossed, titulo: "Personalização", texto: "Adicionais, removíveis e itens de escolha única (tamanho/sabor)." },
];

export default function Landing() {
  const hydrateCardapio = usePub((s) => s.hydrateCardapio);
  const hydrateMesas = usePub((s) => s.hydrateMesas);
  const hydrateMe = usePub((s) => s.hydrateMe);
  useEffect(() => {
    void hydrateCardapio();
    void hydrateMe();
    void hydrateMesas().catch(() => null);
  }, [hydrateCardapio, hydrateMesas, hydrateMe]);

  const sessoes = usePub((s) => s.sessoes);
  const pedidos = usePub((s) => s.pedidos);

  const naFila = pedidos.filter((p) => p.status === "na_fila" || p.status === "em_producao").length;
  const comandas = sessoes.filter((s) => s.status === "aberta").length;
  const consumoAberto = sessoes
    .filter((s) => s.status === "aberta")
    .reduce((a, s) => a + totalSessao(pedidos, s.id) - s.desconto + s.taxa, 0);

  return (
    <div className="relative min-h-dvh overflow-x-clip w-full max-w-[100vw]">
      <FundoPirata variante="admin" />

      {/* nav */}
      <header className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8 pt-6 flex items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-2.5">
          <Badge tone="lime" pulse>salão aberto</Badge>
          <ThemeToggle />
        </div>
      </header>

      {/* HERO */}
      <section className="relative mx-auto max-w-7xl px-5 sm:px-8 pt-8 sm:pt-12">
        <div className="relative overflow-hidden rounded-[2rem] sm:rounded-[3rem] border-2 border-brand-700/40 glass-deep borda-corda">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500/10 via-transparent to-teal-600/10" />
          <div className="glow-orb absolute -top-24 right-[10%] size-[22rem] bg-brand-500/15" />

          <div className="relative px-6 sm:px-12 pt-12 sm:pt-16 pb-10">
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <Badge tone="amber">cardápio &amp; pedidos por QR</Badge>
                <Badge tone="zinc">nesse dispositivo · sem app</Badge>
              </div>

              <div className="flex items-center gap-4 sm:gap-6">
                <Selo tamanho={92} className="hidden sm:block animate-balancar" />
                <div>
                  <p className="font-display text-2xl sm:text-3xl text-brand-700 leading-none">
                    {MARCA.assinatura}
                  </p>
                  <h1 className="font-display leading-[0.85] text-[clamp(3.5rem,12vw,10rem)] mt-2">
                    <span className="block text-navy-900">ACHOU O CAIS.</span>
                    <span className="block stroke-text">ESCANEOU O QR.</span>
                    <span className="block text-ouro">PEDIU NA HORA.</span>
                  </h1>
                </div>
              </div>

              <p className="mt-6 max-w-xl text-slate-600 text-base sm:text-lg leading-relaxed">
                Do celular do cliente até a <b className="text-navy-900">cozinha</b>, o <b className="text-navy-900">garçom</b> e o{" "}
                <b className="text-navy-900">caixa</b> — tudo conectado em tempo real. Uma comanda por visita, vários pedidos,
                PIX na mesa e divisão de conta sem dor de cabeça.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/10 px-4 py-3">
                  <QrCode className="size-6 text-brand-600 shrink-0" />
                  <p className="text-sm text-slate-700 leading-snug max-w-xs">
                    <b className="text-navy-900">Cliente:</b> escaneie o QR Code da sua mesa — o número já vem no link.
                  </p>
                </div>
                <a
                  href={MARCA.instagramUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100/70 px-4 py-3 text-sm font-semibold text-navy-800 hover:border-brand-500/40 transition-colors"
                >
                  <Anchor className="size-4 text-brand-600" /> {MARCA.instagram}
                </a>
              </div>
            </motion.div>

            {/* placar ao vivo */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.8 }}
              className="mt-10 grid grid-cols-3 gap-1.5 sm:gap-4 max-w-lg w-full"
            >
              {[
                { v: String(comandas), l: "comandas abertas" },
                { v: String(naFila), l: "pedidos na chapa" },
                { v: BRL(consumoAberto), l: "consumo no salão" },
              ].map((m) => (
                <div key={m.l} className="glass rounded-2xl px-4 py-3.5">
                  <p className="font-display text-3xl sm:text-4xl text-ouro leading-none">{m.v}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">{m.l}</p>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* faixa de avisos */}
      <div className="relative mt-10 border-y border-slate-200 bg-slate-100/40 py-3 overflow-hidden">
        <div className="flex w-max animate-marquee gap-10 whitespace-nowrap">
          {Array.from({ length: 2 }).map((_, r) => (
            <div key={r} className="flex items-center gap-10 text-[13px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              {["cardápio digital", "alerta de voz", "pix na mesa", "divisão de conta", "estoque vivo", "painel em tempo real", "comanda acumulativa"].map((t) => (
                <span key={t} className="flex items-center gap-10">
                  {t} <Anchor className="size-4 text-brand-500" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* FLUXO */}
      <section className="mx-auto max-w-7xl px-5 sm:px-8 py-16 sm:py-24">
        <motion.div {...fadeUp}>
          <Secao kicker="a travessia" titulo={<>Quatro telas, <span className="text-ouro">zero atrito</span></>} right={<LivePill />} />
        </motion.div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FLUXO.map((f, i) => (
            <motion.div
              key={f.passo}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.08 }}
              className="group relative glass borda-corda rounded-3xl p-6 overflow-hidden hover:border-brand-500/40 transition-colors"
            >
              <span className="font-display text-7xl leading-none text-navy-900/[0.07] absolute -top-2 right-3 group-hover:text-brand-500/10 transition-colors">
                {f.passo}
              </span>
              <f.icon className={`size-7 ${f.tom}`} />
              <h3 className="font-display text-3xl mt-4 text-navy-900">{f.titulo}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.texto}</p>
              {i < 3 && <ArrowRight className="absolute bottom-6 right-6 size-4 text-slate-400 group-hover:text-brand-500 group-hover:translate-x-1 transition-all" />}
            </motion.div>
          ))}
        </div>
      </section>

      {/* RECURSOS */}
      <section className="mx-auto max-w-7xl px-5 sm:px-8 pb-16 sm:pb-24">
        <motion.div {...fadeUp}>
          <Secao kicker="tudo a bordo" titulo={<>O sistema inteiro, <span className="text-ouro">num bolso só</span></>} />
        </motion.div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RECURSOS.map((r, i) => (
            <motion.div
              key={r.titulo}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.06 }}
              className="glass rounded-3xl p-6 hover:border-brand-500/40 transition-colors"
            >
              <div className="grid place-items-center size-11 rounded-2xl bg-gradient-to-br from-brand-500/20 to-teal-600/10 border border-brand-500/25">
                <r.icon className="size-5 text-brand-600" />
              </div>
              <h3 className="mt-4 font-semibold text-navy-900">{r.titulo}</h3>
              <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{r.texto}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div>
            <Logo size="sm" />
            <p className="mt-2 text-xs text-slate-500 max-w-sm">
              {MARCA.rodape}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <a
              href={MARCA.instagramUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 underline decoration-dotted underline-offset-4"
            >
              {MARCA.instagram}
            </a>
            <button
              type="button"
              onClick={() => ir("/login")}
              className="text-[11px] text-slate-400 hover:text-slate-500 transition-colors cursor-pointer"
            >
              acesso da tripulação
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

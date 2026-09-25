/* Alertas de voz (Web Speech API) + beep (WebAudio) — com fila e um lock para não sobrepor falas.
   A voz "desbloqueia" no primeiro toque na página. */

let desbloqueado = false;
let mudo = false;

export function desbloquearAudio() {
  if (desbloqueado) return;
  desbloqueado = true;
  try {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
      speechSynthesis.getVoices();
    }
  } catch {
    /* sem suporte */
  }
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* sem suporte */
  }
}

export function audioMudo(): boolean {
  return mudo;
}
export function setMudo(v: boolean) {
  mudo = v;
  if (v) speechSynthesis.cancel();
}

let vozPronta: SpeechSynthesisVoice | null = null;
function escolherVoz() {
  if (vozPronta || !("speechSynthesis" in window)) return vozPronta;
  const vozes = speechSynthesis.getVoices();
  vozPronta =
    vozes.find((v) => v.lang.toLowerCase().startsWith("pt-br")) ||
    vozes.find((v) => v.lang.toLowerCase().startsWith("pt")) ||
    vozes.find((v) => v.lang.toLowerCase().startsWith("en") && v.name.toLowerCase().includes("google")) ||
    null;
  return vozPronta;
}

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => {
    vozPronta = null;
    escolherVoz();
  };
}

export function falar(texto: string, opts?: { rate?: number; pitch?: number }) {
  if (mudo || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    const v = escolherVoz();
    if (v) u.voice = v;
    u.lang = "pt-BR";
    u.rate = opts?.rate ?? 1;
    u.pitch = opts?.pitch ?? 1;
    u.volume = 1;
    speechSynthesis.speak(u);
  } catch {
    /* silencioso */
  }
}

let ctx: AudioContext | null = null;
export function beep(freq = 880, dur = 0.12, quando = 0) {
  if (mudo) return;
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + quando;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    /* silencioso */
  }
}

export const beepDuplo = () => {
  beep(760, 0.1, 0);
  beep(1040, 0.14, 0.13);
};

export const beepAlerta = () => {
  beep(520, 0.1, 0);
  beep(520, 0.1, 0.16);
  beep(780, 0.18, 0.32);
};

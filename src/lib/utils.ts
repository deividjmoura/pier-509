/* Formatação + payload PIX (EMV / BR Code) com CRC16-CCITT-FALSE */

export const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const hora = (ts: number) =>
  new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export const elapsed = (ts: number) => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

/* ---------------- PIX EMV (BR Code) ---------------- */

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — padrão BACEN/BR Code */
function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const emv = (id: string, valor: string) =>
  `${id}${String(valor.length).padStart(2, "0")}${valor}`;

const asciiLimpo = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/**
 * Normaliza a chave PIX sem destruir e-mail nem chave aleatória (EVP).
 *
 * Implementação única em `db/pix-normaliza.js`, compartilhada com o server.js.
 * Manter duas cópias foi a causa de um bug real: a cópia do servidor não
 * checava letras e reescrevia chave aleatória como CPF/telefone.
 */
import { normalizarChavePix } from "../../db/pix-normaliza.js";

export { normalizarChavePix };

export function montarPixEMV(opts: {
  chave: string;
  nome: string;
  cidade: string;
  valor?: number | null;
  txid?: string;
}): string {
  const chave = normalizarChavePix(opts.chave);
  if (!chave || chave === "00000000000" || chave === "00000000000000") {
    // Payload de placeholder que o banco rejeita — evita QR “bonito” mas inválido
    console.warn("[PIX] chave vazia ou placeholder — configure PIX_CHAVE no servidor");
  }

  const nome = asciiLimpo(opts.nome).slice(0, 25) || "RECEBEDOR";
  const cidade = asciiLimpo(opts.cidade).slice(0, 15) || "BRASIL";
  const gui = emv("00", "BR.GOV.BCB.PIX");
  const key = emv("01", chave);
  const mai = emv("26", gui + key);

  let txid = String(opts.txid || "***")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 25);
  if (!txid) txid = "***";

  const valorStr =
    opts.valor != null && Number(opts.valor) > 0
      ? Number(opts.valor).toFixed(2)
      : "";

  // Payload estático (sem 01/12). Campo 54 só se houver valor.
  let payload =
    emv("00", "01") +
    mai +
    emv("52", "0000") +
    emv("53", "986") +
    (valorStr ? emv("54", valorStr) : "") +
    emv("58", "BR") +
    emv("59", nome) +
    emv("60", cidade) +
    emv("62", emv("05", txid)) +
    "6304";

  return payload + crc16(payload);
}

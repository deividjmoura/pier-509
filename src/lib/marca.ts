/**
 * Identidade do estabelecimento — fonte única de verdade.
 *
 * Trocar aqui muda a marca em todas as telas (cliente, cozinha, bar, garçom,
 * caixa, admin, impressão e metadados da página). Evite escrever "PIER 509"
 * solto nos componentes: importe daqui.
 */

export const MARCA = {
  nome: "Pier 509",
  nomeCurto: "Pier 509",
  /** Como o nome aparece em caixa alta (títulos, cupons, rodapés). */
  nomeCaixaAlta: "PIER 509",
  /** Assinatura curta usada no rodapé e nos impressos. */
  assinatura: "Pier 509 · Lanchonete & Pub",
  slogan: "Peça da mesa, sem esperar",
  bairro: "Itajaí · SC",
  instagram: "@pier.509",
  instagramUrl: "https://www.instagram.com/pier.509/",
  /** WhatsApp do atendimento (opcional). Preencha para exibir o botão. */
  whatsapp: "",
  /** Deixe vazio para não exibir telefone nas telas do cliente. */
  telefone: "",
  /** Aviso legal do rodapé do cliente. */
  rodape: "Pedidos por QR Code · cozinha, garçom e caixa em tempo real",
} as const;

/** Domínio público (usado em metadados e no QR de compartilhamento). */
export const DOMINIO = "https://pier509.com.br";

/** Caminho do selo (emblema circular) em cada resolução. */
export const SELO = {
  png512: "/assets/marca/selo-512.png",
  png256: "/assets/marca/selo-256.png",
  webp512: "/assets/marca/selo-512.webp",
  webp256: "/assets/marca/selo-256.webp",
} as const;

/** Etiquetas de papel do staff — usadas em login e navegação. */
export const PAPEL_LABEL: Record<string, string> = {
  admin: "Comando",
  cozinha: "Cozinha",
  bar: "Bar",
  caixa: "Caixa",
};

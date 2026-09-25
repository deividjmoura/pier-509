/* Modelo de domínio — espelha as entidades do sistema (mesa, sessão, pedido…)
   sem alterar o comportamento original. */

export type Role = "admin" | "cozinha" | "bar" | "caixa";

export interface Opcao {
  id: string;
  nome: string;
  preco: number; // acréscimo em R$
}

export interface Removivel {
  id: string;
  nome: string;
}

export interface Categoria {
  id: number;
  nome: string;
  ordem: number;
}

export type TipoProduto = "simples" | "personalizavel" | "escolher";

export interface Produto {
  id: number;
  nome: string;
  descricao: string;
  preco: number;
  categoria: string;
  /** ordem da categoria no cardápio (admin) */
  categoriaOrdem?: number;
  /** ordem do item dentro da categoria */
  ordem?: number;
  foto: string;
  tipo: TipoProduto;
  adicionais: Opcao[]; // multi-seleção
  removiveis: Removivel[]; // toggles "sem X"
  ativo: boolean;
  /** Quem produz: cozinha (comida) ou bar (bebida) */
  setor?: "cozinha" | "bar";
  estoque: number | null; // null = não controla
  vendidos: number;
}

export type ItemStatus = "recebido" | "em_producao" | "concluido" | "entregue";

export interface ItemPedido {
  id: string;
  produtoId: number;
  nome: string;
  qtd: number;
  precoBase: number;
  adicionais: Opcao[];
  removidos: string[];
  escolha: Opcao | null;
  obs: string;
  totalUnit: number; // (base + adicionais + escolha)
  /** Status de produção/entrega do item (parcial) */
  status?: ItemStatus;
  setor?: "cozinha" | "bar";
}

export type PedidoStatus = "na_fila" | "em_producao" | "pronto" | "entregue";

export interface Pedido {
  id: number;
  sessaoId: number;
  mesaId: number;
  mesaNome: string;
  clienteNome: string;
  itens: ItemPedido[];
  status: PedidoStatus;
  criadoEm: number;
  total: number;
}

export type FormaPagamento = "pix" | "dinheiro" | "credito" | "debito";

export interface Pagamento {
  id: number;
  valor: number;
  forma: FormaPagamento;
  criadoEm: number;
}

export type SessaoStatus = "aberta" | "fechada";

export interface Sessao {
  id: number;
  mesaId: number;
  mesaNome: string;
  status: SessaoStatus;
  abertaEm: number;
  fechadaEm: number | null;
  pagamentos: Pagamento[];
  pixAvisos: number;
  desconto: number; // R$ (ajuste local até fechar — backend aplica no close)
  taxa: number; // R$
  /** totais vindos de GET /api/caixa/sessoes */
  valorTotal?: number;
  valorPago?: number;
  valorRestante?: number;
  pedidosPendentes?: number;
  podeFechar?: boolean;
  clienteNome?: string | null;
}

export interface Mesa {
  id: number;
  numero: number;
  token: string;
  nome: string;
}

export type EventoTipo =
  | "pedido-novo"
  | "pedido-aceito"
  | "pedido-pronto"
  | "pedido-entregue"
  | "pedido-cancelado"
  | "pix-avisado"
  | "sessao-fechada";

export interface Evento {
  seq: number;
  tipo: EventoTipo;
  texto: string;
  mesaNome?: string;
  em: number;
}

export interface PixConfig {
  chave: string;
  nome: string;
  cidade: string;
  /** Diagnóstico do servidor: false = PIX_CHAVE ausente/placeholder/desconhecida */
  chaveValida?: boolean;
  tipoChave?: string;
  aviso?: string | null;
}

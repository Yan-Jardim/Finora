import type { AccountType, GoalKind, GoalStatus, PocketMovementKind, TransactionKind, TransactionStatus } from "@/domain/types";

/** Rótulos pt-BR. Ponto único a ser substituído por um sistema de i18n no futuro. */
export const transactionKindLabel: Record<TransactionKind, string> = {
  income: "Receita",
  expense: "Despesa",
  credit_card_purchase: "Compra no cartão",
  transfer: "Transferência",
  debt_payment: "Pagamento de dívida",
  card_payment: "Pagamento de fatura",
  investment: "Investimento",
  redemption: "Resgate",
};

export const transactionStatusLabel: Record<TransactionStatus, string> = {
  planned: "Previsto",
  pending: "Pendente",
  paid: "Pago",
  overdue: "Atrasado",
  canceled: "Cancelado",
};

export const accountTypeLabel: Record<AccountType, string> = {
  checking: "Conta corrente",
  digital: "Conta digital",
  savings: "Poupança",
  wallet: "Carteira",
  cash: "Dinheiro",
  investment: "Investimento",
  other: "Outro",
};

export const cardBrandLabel = {
  visa: "Visa",
  mastercard: "Mastercard",
  elo: "Elo",
  amex: "American Express",
  hipercard: "Hipercard",
  other: "Outra",
} as const;

/** Rótulo de status conforme o tipo: receita paga = "Recebido"; demais = "Pago". */
export function statusLabel(kind: TransactionKind, status: TransactionStatus): string {
  if (status === "paid") return kind === "income" ? "Recebido" : "Pago";
  return transactionStatusLabel[status];
}

export const pocketMovementLabel: Record<PocketMovementKind, string> = {
  reserve: "Reserva",
  withdraw: "Retirada",
  transfer_in: "Transferência recebida",
  transfer_out: "Transferência enviada",
  use: "Utilizado em despesa",
  use_reversal: "Estorno",
};

export const goalKindLabel: Record<GoalKind, string> = {
  travel: "Viagem",
  emergency: "Reserva de emergência",
  purchase: "Compra",
  education: "Educação",
  housing: "Moradia",
  vehicle: "Veículo",
  retirement: "Aposentadoria",
  other: "Outro",
};

export const goalStatusLabel: Record<GoalStatus, string> = {
  active: "Ativo",
  paused: "Pausado",
  completed: "Concluído",
  canceled: "Cancelado",
};

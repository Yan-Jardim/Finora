import type { Transaction } from "./types";

/**
 * Normaliza movimentações salvas por versões anteriores (idempotente).
 * Etapa 2 gravava compra no cartão como `expense` + cardId; agora é `credit_card_purchase`.
 */
export function normalizeTransaction(tx: Transaction): Transaction {
  if (tx.kind === "expense" && tx.cardId) return { ...tx, kind: "credit_card_purchase" };
  return tx;
}

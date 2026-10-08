import { addMonths } from "./dates";
import type { Cents, ID, ISODate, Transaction } from "./types";

/**
 * Compra parcelada.
 * - A compra original (InstallmentPurchase) é só o agrupador: NUNCA entra em somas.
 * - Cada parcela é uma Transaction (credit_card_purchase) ligada à compra por installment.purchaseId.
 * Assim a despesa é contada uma única vez, parcela a parcela.
 */

/**
 * Divide em n parcelas sem perder centavos: o resto vai, 1 centavo por vez, para as primeiras.
 * 100000 / 3 -> [33334, 33333, 33333] (soma = 100000).
 */
export function splitCents(total: Cents, parts: number): Cents[] {
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

export interface InstallmentPurchaseInput {
  description: string;
  totalCents: Cents;
  installments: number;
  /** Data da compra (1ª parcela). */
  date: ISODate;
  cardId: ID;
  profileId: ID;
  categoryId?: ID;
  tags: string[];
  notes?: string;
}

/** Gera as parcelas (sem id). Parcela n vence na fatura n após a da compra (mesmo dia, mês a mês). */
export function buildInstallments(
  input: InstallmentPurchaseInput,
  purchaseId: ID,
  today: ISODate,
): Omit<Transaction, "id">[] {
  const amounts = splitCents(input.totalCents, input.installments);
  return amounts.map((amountCents, index) => {
    const date = addMonths(input.date, index);
    return {
      kind: "credit_card_purchase" as const,
      description: input.description,
      amountCents,
      date,
      status: date <= today ? ("pending" as const) : ("planned" as const),
      categoryId: input.categoryId,
      tags: input.tags,
      cardId: input.cardId,
      profileId: input.profileId,
      notes: input.notes,
      installment: { purchaseId, number: index + 1, total: input.installments, purchaseDate: input.date },
    };
  });
}

export type InstallmentScope = "this" | "future" | "all";

export const installmentGroup = (transactions: Transaction[], purchaseId: ID) =>
  transactions
    .filter((t) => t.installment?.purchaseId === purchaseId)
    .sort((a, b) => a.installment!.number - b.installment!.number);

export interface ScopePlan {
  /** Parcelas que serão alteradas/excluídas. */
  affected: Transaction[];
  /** Parcelas dentro do escopo que foram PRESERVADAS por já estarem pagas. */
  keptPaid: Transaction[];
}

/**
 * Quais parcelas um escopo atinge. "future" = esta e as próximas; "all" = a compra inteira.
 * Parcelas protegidas (fatura já paga) nunca são afetadas em escopos amplos.
 */
export function planScope(
  group: Transaction[],
  tx: Transaction,
  scope: InstallmentScope,
  isProtected: (t: Transaction) => boolean,
): ScopePlan {
  if (scope === "this") return { affected: [tx], keptPaid: [] };
  const inScope = scope === "all" ? group : group.filter((t) => t.installment!.number >= tx.installment!.number);
  return {
    affected: inScope.filter((t) => !isProtected(t)),
    keptPaid: inScope.filter((t) => isProtected(t)),
  };
}

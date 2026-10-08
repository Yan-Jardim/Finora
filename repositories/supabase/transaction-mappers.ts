import type { Cents, Transaction } from "@/domain/types";
import type { TransactionPatch } from "@/services/transaction-commands";

type Row = Record<string, unknown>;

/**
 * Colunas lidas + relações embutidas (uma ida ao banco):
 *  - installment: total e data da compra original (para "Parcela n/total");
 *  - invoice: mês de vencimento da fatura que o BANCO atribuiu (compras) ou quitou (pagamentos);
 *  - tag_links: nomes das tags.
 */
export const TRANSACTION_SELECT =
  "*, installment:installment_purchases!transactions_installment_purchase_fk(installments_count,purchase_date), " +
  "invoice:card_invoices!transactions_invoice_fk(due_month), tag_links:transaction_tags(tag:tags(name))";

interface JoinedRow {
  installment?: { installments_count: number; purchase_date: string } | null;
  invoice?: { due_month: string } | null;
  tag_links?: { tag: { name: string } | null }[] | null;
}

const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

/** Linha do banco -> movimentação de domínio. Dinheiro em centavos; datas ISO. */
export function transactionFromRow(row: Row): Transaction {
  const r = row as Row & JoinedRow;
  const installmentNumber = r.installment_number as number | null;
  return {
    id: r.id as string,
    kind: r.kind as Transaction["kind"],
    description: r.description as string,
    amountCents: Number(r.amount_cents) as Cents,
    date: r.date as string,
    dueDate: orUndefined(r.due_date as string | null),
    paidAt: orUndefined(r.paid_at as string | null),
    status: r.status as Transaction["status"],
    categoryId: orUndefined(r.category_id as string | null),
    tags: (r.tag_links ?? [])
      .map((link) => link.tag?.name)
      .filter((name): name is string => !!name)
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
    accountId: orUndefined(r.account_id as string | null),
    toAccountId: orUndefined(r.to_account_id as string | null),
    cardId: orUndefined(r.card_id as string | null),
    invoiceMonth: r.invoice?.due_month ? r.invoice.due_month.slice(0, 7) : undefined,
    profileId: r.profile_id as string,
    notes: orUndefined(r.notes as string | null),
    recurringId: orUndefined(r.recurring_transaction_id as string | null),
    debtId: orUndefined(r.debt_id as string | null),
    occurrenceDate: orUndefined(r.occurrence_date as string | null),
    canceledByRule: r.canceled_by_rule === true ? true : undefined,
    installment:
      r.installment_purchase_id && installmentNumber != null
        ? {
            purchaseId: r.installment_purchase_id as string,
            number: installmentNumber,
            total: r.installment?.installments_count ?? installmentNumber,
            purchaseDate: orUndefined(r.installment?.purchase_date),
          }
        : undefined,
  };
}

/**
 * Chaves aceitas por update_transaction / update_installments (snake_case do banco).
 * `undefined` no domínio vira NULL (limpa o campo) — JSON.stringify descartaria a chave.
 */
const NULLABLE_COLUMNS = {
  dueDate: "due_date",
  paidAt: "paid_at",
  categoryId: "category_id",
  accountId: "account_id",
  toAccountId: "to_account_id",
  cardId: "card_id",
  notes: "notes",
} as const;
const REQUIRED_COLUMNS = {
  description: "description",
  amountCents: "amount_cents",
  date: "date",
  status: "status",
  profileId: "profile_id",
} as const;

/** Patch para update_transaction (movimentação comum). Tags vão em parâmetro próprio (p_tags). */
export function toTransactionRpcPatch(tx: Transaction, patch: TransactionPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cardPurchase = tx.kind === "credit_card_purchase";
  for (const [key, column] of Object.entries(REQUIRED_COLUMNS)) {
    if (!(key in patch)) continue;
    // Compra no cartão nunca é "paga" e seu status é derivado da data pelo BANCO (fuso do household).
    if (cardPurchase && key === "status") continue;
    out[column] = (patch as Row)[key];
  }
  for (const [key, column] of Object.entries(NULLABLE_COLUMNS)) {
    if (!(key in patch)) continue;
    if (cardPurchase && key === "paidAt") continue;
    out[column] = (patch as Row)[key] ?? null;
  }
  return out;
}

/**
 * Patch para update_installments. Em "this": descrição, categoria, observação, perfil, tags, valor e data.
 * Em "future": só os campos descritivos (valor e data de cada parcela são mantidos). Chaves fora disso são ignoradas
 * (o formulário de parcela também envia, por exemplo, cardId/status, que não se aplicam).
 */
export function toInstallmentRpcPatch(patch: TransactionPatch, scope: "this" | "future"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("description" in patch) out.description = patch.description;
  if ("categoryId" in patch) out.category_id = patch.categoryId ?? null;
  if ("notes" in patch) out.notes = patch.notes ?? null;
  if ("profileId" in patch) out.profile_id = patch.profileId;
  if ("tags" in patch) out.tags = patch.tags ?? [];
  if (scope === "this") {
    if ("amountCents" in patch) out.amount_cents = patch.amountCents;
    if ("date" in patch) out.date = patch.date;
  }
  return out;
}

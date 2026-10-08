import type { Invoice } from "./calculations";
import { invoiceKey, isCardPurchase, purchaseInvoiceMonth } from "./calculations";
import type { Account, Category, CreditCard, FinancialProfile, Transaction, WorkspaceData } from "./types";

/**
 * Regras de integridade (puras). Retornam a mensagem do motivo ou null se permitido.
 * Hoje rodam no cliente; no Supabase viram constraints/RLS + a mesma checagem no servidor.
 */

const norm = (value: string) => value.trim().toLocaleLowerCase("pt-BR");

export function duplicateProfileName(name: string, profiles: FinancialProfile[], ignoreId?: string) {
  return profiles.some((p) => p.id !== ignoreId && norm(p.name) === norm(name))
    ? "Já existe uma pessoa com esse nome."
    : null;
}

export function duplicateCategoryName(
  name: string,
  parentId: string | undefined,
  categories: Category[],
  ignoreId?: string,
) {
  return categories.some((c) => c.id !== ignoreId && c.parentId === parentId && norm(c.name) === norm(name))
    ? "Já existe uma categoria com esse nome neste nível."
    : null;
}

export function duplicateAccountName(name: string, accounts: Account[], ignoreId?: string) {
  return accounts.some((a) => a.id !== ignoreId && norm(a.name) === norm(name))
    ? "Já existe uma conta com esse nome."
    : null;
}

export function duplicateCardName(name: string, cards: CreditCard[], ignoreId?: string) {
  return cards.some((c) => c.id !== ignoreId && norm(c.name) === norm(name))
    ? "Já existe um cartão com esse nome."
    : null;
}

export function categoryDeleteBlocker(category: Category, data: WorkspaceData) {
  if (data.categories.some((c) => c.parentId === category.id))
    return "Esta categoria possui subcategorias. Exclua ou mova as subcategorias primeiro.";
  if (data.transactions.some((t) => t.categoryId === category.id))
    return "Esta categoria já foi usada em movimentações. Desative-a em vez de excluir.";
  return null;
}

export function accountDeleteBlocker(account: Account, data: WorkspaceData) {
  if (data.transactions.some((t) => t.accountId === account.id || t.toAccountId === account.id))
    return "Esta conta possui movimentações. Desative-a em vez de excluir.";
  if (data.creditCards.some((c) => c.accountId === account.id))
    return "Há cartões que pagam a fatura por esta conta. Altere os cartões primeiro.";
  if (data.pockets.some((p) => p.accountId === account.id)) return "Esta conta possui reservas vinculadas.";
  return null;
}

export function cardDeleteBlocker(card: CreditCard, data: WorkspaceData) {
  return data.transactions.some((t) => t.cardId === card.id)
    ? "Este cartão possui compras registradas. Desative-o em vez de excluir."
    : null;
}

/** Subcategoria só pode ter pai raiz, e quem tem filhos não pode virar filho. */
export function validParentOptions(categories: Category[], editing?: Category) {
  if (editing && categories.some((c) => c.parentId === editing.id)) return [];
  return categories.filter((c) => !c.parentId && c.id !== editing?.id);
}

// ---------- Movimentações ----------

/**
 * Compra no cartão cuja fatura já foi quitada fica travada: alterá-la faria a fatura e o
 * pagamento divergirem. Para mexer, exclua antes o pagamento da fatura.
 */
export function transactionLockReason(
  tx: Transaction,
  cards: Map<string, CreditCard>,
  invoices: Map<string, Invoice>,
): string | null {
  if (!isCardPurchase(tx) || tx.status === "canceled" || !tx.cardId) return null;
  const card = cards.get(tx.cardId);
  if (!card) return null;
  const invoice = invoices.get(invoiceKey(card.id, purchaseInvoiceMonth(card, tx)));
  return invoice?.paid
    ? "A fatura desta compra já foi paga. Exclua o pagamento da fatura antes de alterar esta compra."
    : null;
}

/** Tipos que o formulário de movimentações sabe editar. */
export const EDITABLE_KINDS: Transaction["kind"][] = ["income", "expense", "transfer", "credit_card_purchase"];

/** Pagamento de fatura não pode exceder o valor em aberto. */
export function invoicePaymentError(invoice: Invoice | undefined, amountCents: number): string | null {
  if (!invoice || invoice.openCents <= 0) return "Esta fatura não possui valor em aberto.";
  if (amountCents <= 0) return "Informe um valor maior que zero.";
  if (amountCents > invoice.openCents) return "O pagamento não pode ser maior que o valor em aberto da fatura.";
  return null;
}

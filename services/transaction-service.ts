import { invoiceIndex } from "@/domain/calculations";
import { buildInstallments, installmentGroup, planScope, type InstallmentPurchaseInput, type InstallmentScope } from "@/domain/installments";
import { invoicePaymentError, transactionLockReason } from "@/domain/rules";
import type { InstallmentPurchase, ISODate, RecurringTransaction, Transaction, TransactionStatus, WorkspaceData } from "@/domain/types";
import { formatMonthYear } from "@/lib/format";
import { friendlyDbMessage } from "@/repositories/supabase/errors";
import type { Repository } from "@/repositories/types";
import { assertBacked, assertNotPocketUse, type ReserveGuardRepos } from "./reserve-guard";
import type { DeleteResult, PayInvoiceInput, TransactionPatch } from "./transaction-commands";

export type { DeleteResult, PayInvoiceInput, TransactionPatch };

/**
 * MOTOR LOCAL de movimentações (localStorage): orquestra repositórios + regras de domínio no cliente.
 * Os componentes não o chamam diretamente: usam `TransactionCommands` (services/transaction-commands.ts);
 * `LocalTransactionCommands` adapta estas funções. No modo Supabase o equivalente são as RPCs do banco.
 * Também é a referência de comportamento dos testes de paridade.
 * Cada função valida as regras de integridade e lança Error com mensagem amigável.
 */

/** Repositórios com escrita (só o armazenamento local oferece o contrato completo). */
export interface TxRepos extends ReserveGuardRepos {
  transactions: Repository<Transaction>;
  installmentPurchases: Repository<InstallmentPurchase>;
  /** Opcional: só o motor de recorrência local precisa (registrar ocorrências puladas). */
  recurring?: Repository<RecurringTransaction>;
}

/** Pagamento de dívida só muda pelo fluxo da dívida (editar/status quebrariam o estado dela); excluir desfaz. */
function assertNotDebtPayment(tx: Transaction) {
  if (tx.debtId) throw new Error(friendlyDbMessage({ message: "use_debt_flow" }));
}

const context = (data: WorkspaceData) => ({
  cards: new Map(data.creditCards.map((c) => [c.id, c])),
  invoices: invoiceIndex(data.creditCards, data.transactions),
});

function assertUnlocked(tx: Transaction, data: WorkspaceData) {
  const { cards, invoices } = context(data);
  const reason = transactionLockReason(tx, cards, invoices);
  if (reason) throw new Error(reason);
}

const isProtected = (data: WorkspaceData) => {
  const { cards, invoices } = context(data);
  return (t: Transaction) => transactionLockReason(t, cards, invoices) !== null;
};

export async function createTransaction(repos: TxRepos, input: Omit<Transaction, "id">) {
  // Lastro dos cofrinhos: uma saída paga não pode deixar reserva sem saldo na conta (equivale ao trigger do banco).
  await assertBacked(repos, { after: { ...input, id: "novo" } });
  return repos.transactions.create(input);
}

/** Cria a compra (agrupador) e TODAS as parcelas de uma vez. */
export async function createInstallmentPurchase(repos: TxRepos, input: InstallmentPurchaseInput, today: ISODate) {
  if (input.installments < 2) throw new Error("Uma compra parcelada precisa de pelo menos 2 parcelas.");
  const purchase = await repos.installmentPurchases.create({
    description: input.description,
    totalCents: input.totalCents,
    installments: input.installments,
    firstDate: input.date,
    cardId: input.cardId,
    profileId: input.profileId,
    categoryId: input.categoryId,
    tags: input.tags,
    notes: input.notes,
  });
  const transactions = await repos.transactions.createMany(buildInstallments(input, purchase.id, today));
  return { purchase, transactions };
}

/**
 * Registra o pagamento da fatura: sai da conta, reduz o valor em aberto e libera limite.
 * É um `card_payment` — NÃO é despesa (o gasto já foi contado nas compras).
 */
export async function payInvoice(repos: TxRepos, data: WorkspaceData, input: PayInvoiceInput) {
  const card = data.creditCards.find((c) => c.id === input.cardId);
  if (!card) throw new Error("Cartão não encontrado.");
  const invoice = invoiceIndex([card], data.transactions).get(`${card.id}|${input.dueMonth}`);
  const error = invoicePaymentError(invoice, input.amountCents);
  if (error) throw new Error(error);

  const payment: Omit<Transaction, "id"> = {
    kind: "card_payment",
    description: `Fatura ${card.name} — ${formatMonthYear(input.dueMonth)}`,
    amountCents: input.amountCents,
    date: input.date,
    paidAt: input.date,
    status: "paid",
    accountId: input.accountId,
    cardId: card.id,
    invoiceMonth: input.dueMonth,
    profileId: card.ownerProfileId,
    tags: [],
  };
  await assertBacked(repos, { after: { ...payment, id: "novo" } });
  return repos.transactions.create(payment);
}

export async function setTransactionStatus(
  repos: TxRepos,
  data: WorkspaceData,
  tx: Transaction,
  status: TransactionStatus,
  today: ISODate,
) {
  assertNotDebtPayment(tx);
  assertUnlocked(tx, data);
  await assertNotPocketUse(repos, tx);
  const paidAt = status === "paid" ? today : undefined;
  await assertBacked(repos, { before: tx, after: { ...tx, status, paidAt } });
  return repos.transactions.update(tx.id, { status, paidAt });
}

/** Campos que fazem sentido propagar para outras parcelas (nunca valor/data). */
const SHARED_FIELDS = ["description", "categoryId", "tags", "notes", "profileId"] as const;

export async function updateTransaction(
  repos: TxRepos,
  data: WorkspaceData,
  tx: Transaction,
  patch: TransactionPatch,
  scope: InstallmentScope = "this",
) {
  assertNotDebtPayment(tx);
  assertUnlocked(tx, data);
  await assertNotPocketUse(repos, tx, patch);
  if (!tx.installment || scope === "this") {
    await assertBacked(repos, { before: tx, after: { ...tx, ...patch } });
    await repos.transactions.update(tx.id, patch);
    return;
  }
  // "Esta e as próximas": aplica só campos descritivos; parcelas pagas são preservadas.
  const shared = Object.fromEntries(SHARED_FIELDS.filter((f) => f in patch).map((f) => [f, patch[f]]));
  const group = installmentGroup(data.transactions, tx.installment.purchaseId);
  const { affected } = planScope(group, tx, scope, isProtected(data));
  for (const target of affected) await repos.transactions.update(target.id, shared);
}

/** Exclui respeitando as regras: nada é excluído "em silêncio" se estiver pago. */
export async function deleteTransaction(
  repos: TxRepos,
  data: WorkspaceData,
  tx: Transaction,
  scope: InstallmentScope = "this",
): Promise<DeleteResult> {
  if (tx.debtId && data.debts.some((d) => d.id === tx.debtId && d.settledAt)) {
    throw new Error(friendlyDbMessage({ message: "debt_settled_locked" }));
  }
  assertUnlocked(tx, data);
  await assertNotPocketUse(repos, tx);

  if (!tx.installment) {
    await assertBacked(repos, { before: tx });
    await repos.transactions.remove(tx.id);
    return { deleted: 1, keptPaid: 0 };
  }

  const purchaseId = tx.installment.purchaseId;
  const group = installmentGroup(data.transactions, purchaseId);
  const { affected, keptPaid } = planScope(group, tx, scope, isProtected(data));
  await repos.transactions.removeMany(affected.map((t) => t.id));

  // Sem parcelas restantes, o agrupador some junto.
  if (affected.length === group.length) await repos.installmentPurchases.remove(purchaseId);
  return { deleted: affected.length, keptPaid: keptPaid.length };
}

/** Exposto para a UI mostrar o impacto antes de confirmar. */
export function previewScope(data: WorkspaceData, tx: Transaction, scope: InstallmentScope) {
  if (!tx.installment) return { affected: [tx], keptPaid: [] as Transaction[] };
  const group = installmentGroup(data.transactions, tx.installment.purchaseId);
  return planScope(group, tx, scope, isProtected(data));
}


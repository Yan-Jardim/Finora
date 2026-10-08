import {
  accountBalance,
  cardInvoices,
  cardUsedLimit,
  invoiceKey,
  type Invoice,
} from "./calculations";
import { deriveDebtViews, type DebtInstallment, type DebtSummary } from "./debts";
import { pocketBalances, reservedByAccount } from "./pockets";
import type { Account, Cents, CreditCard, ISODate, Pocket, WorkspaceData } from "./types";

/**
 * Valores DERIVADOS do ledger, prontos para exibir: saldo por conta, faturas e limite usado por cartão.
 *
 * - modo local: `deriveSnapshot` calcula com as funções puras de domain/calculations sobre TODAS as movimentações.
 * - modo supabase: vêm das views (v_account_balances, v_card_invoice_totals, v_card_usage) — o navegador NÃO
 *   recalcula o histórico (que, de qualquer forma, nem é carregado por inteiro).
 *
 * As duas origens produzem o mesmo formato; as telas e o dashboard só conhecem o snapshot.
 */
export interface FinanceSnapshot {
  /** Saldo atual por conta (saldo inicial + movimentações pagas). */
  accountBalances: Map<string, Cents>;
  /** Todas as faturas (de todos os cartões). */
  invoices: Invoice[];
  /** Limite utilizado por cartão. */
  usedLimits: Map<string, Cents>;
  /** Resumo derivado de cada dívida (pago, restante, progresso, situação). */
  debts: DebtSummary[];
  /** Cronograma derivado das parcelas das dívidas, com os pagamentos já alocados. */
  debtInstallments: DebtInstallment[];
  /** Saldo reservado por cofrinho (v_pocket_balances; local: soma do histórico). Nunca gravado. */
  pocketBalances: Map<string, Cents>;
  /** Total reservado por conta (v_account_reserves; local: soma dos cofrinhos da conta). */
  accountReserved: Map<string, Cents>;
}

export function deriveSnapshot(
  data: Pick<WorkspaceData, "accounts" | "creditCards" | "transactions" | "debts" | "pockets" | "pocketMovements">,
  today: ISODate,
): FinanceSnapshot {
  const debtViews = deriveDebtViews(data.debts, data.transactions, today);
  return {
    debts: debtViews.summaries,
    debtInstallments: debtViews.installments,
    accountBalances: new Map(data.accounts.map((a) => [a.id, accountBalance(a, data.transactions)])),
    invoices: data.creditCards.flatMap((card) => cardInvoices(card, data.transactions)),
    usedLimits: new Map(data.creditCards.map((c) => [c.id, cardUsedLimit(c, data.transactions, today)])),
    pocketBalances: pocketBalances(data.pocketMovements),
    accountReserved: reservedByAccount(data.pockets, data.pocketMovements),
  };
}

/** Snapshot do workspace: o que veio do banco, ou derivado das movimentações (modo local). */
export const snapshotOf = (data: WorkspaceData, today: ISODate): FinanceSnapshot =>
  data.snapshot ?? deriveSnapshot(data, today);

export const snapshotBalance = (snapshot: FinanceSnapshot, account: Pick<Account, "id" | "initialBalanceCents">): Cents =>
  snapshot.accountBalances.get(account.id) ?? account.initialBalanceCents;

export const snapshotUsedLimit = (snapshot: FinanceSnapshot, card: Pick<CreditCard, "id">): Cents =>
  snapshot.usedLimits.get(card.id) ?? 0;

/** Saldo reservado de um cofrinho (derivado). */
export const snapshotPocketBalance = (snapshot: FinanceSnapshot, pocket: Pick<Pocket, "id">): Cents =>
  snapshot.pocketBalances.get(pocket.id) ?? 0;

/** Total reservado em cofrinhos numa conta (derivado). */
export const snapshotReserved = (snapshot: FinanceSnapshot, accountId: string): Cents => snapshot.accountReserved.get(accountId) ?? 0;

/** Dinheiro LIVRE da conta = saldo bancário − reservado (pode ser negativo). */
export const snapshotFree = (snapshot: FinanceSnapshot, account: Pick<Account, "id" | "initialBalanceCents">): Cents =>
  snapshotBalance(snapshot, account) - snapshotReserved(snapshot, account.id);

export const snapshotCardInvoices = (snapshot: FinanceSnapshot, cardId: string): Invoice[] =>
  snapshot.invoices.filter((i) => i.cardId === cardId).sort((a, b) => a.dueMonth.localeCompare(b.dueMonth));

/** Índice cartão+mês de vencimento -> fatura (para travas e status de exibição). */
export function snapshotInvoiceIndex(snapshot: FinanceSnapshot): Map<string, Invoice> {
  return new Map(snapshot.invoices.map((i) => [invoiceKey(i.cardId, i.dueMonth), i]));
}

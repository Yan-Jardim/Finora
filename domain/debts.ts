import { addMonths } from "./dates";
import { splitCents } from "./installments";
import type { Cents, Debt, DebtDerivedStatus, ISODate, Transaction } from "./types";

/**
 * Dívidas — regras puras (sem I/O). ESPELHO das views do banco (v_debt_installments e v_debt_summary): o mesmo roteiro
 * roda no motor local e no Supabase e precisa dar o mesmo resultado (tests/parity-debts.supabase.test.ts).
 *
 * Modelo (uma única fonte de verdade, sem dupla contagem):
 *  - a DÍVIDA é o contrato (valor original, total, nº de parcelas, 1º vencimento);
 *  - as PARCELAS são derivadas: split_cents(total, N), vencendo mês a mês a partir do 1º vencimento. Obrigação futura
 *    não é dinheiro movido, então não é Transaction;
 *  - os PAGAMENTOS são as únicas Transactions (debt_payment, pagas, com debtId): movem saldo e são despesa realizada;
 *  - pago/restante/progresso/situação = derivados. Os pagamentos cobrem as parcelas EM ORDEM (cascata).
 */

export interface DebtInstallment {
  debtId: string;
  number: number;
  dueDate: ISODate;
  amountCents: Cents;
  /** Quanto dos pagamentos já cobre esta parcela. */
  paidCents: Cents;
  /** Em aberto (zero se a dívida foi quitada por acordo ou cancelada). */
  openCents: Cents;
  status: "paid" | "partial" | "open";
  /** Em aberto, dívida ativa e vencimento anterior a hoje. */
  overdue: boolean;
}

export interface DebtSummary {
  debtId: string;
  principalCents: Cents;
  totalCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
  /** total - original: só para exibição (não reconstrói taxa de juros). */
  financialCostCents: Cents;
  /** 0 a 100, duas casas. */
  progressPercent: number;
  installmentsCount: number | null;
  installmentsPaid: number;
  installmentsOpen: number;
  nextDueDate?: ISODate;
  nextOpenCents?: Cents;
  paymentsCount: number;
  settledAt?: ISODate;
  settlementDiscountCents?: Cents;
  status: DebtDerivedStatus;
}

/** Pagamento que conta: transação de dívida paga e ligada a ela. */
export const isDebtPayment = (tx: Transaction) => tx.kind === "debt_payment" && !!tx.debtId && tx.status === "paid";

/** Total pago e quantidade de pagamentos de uma dívida (a ÚNICA origem do "pago"). */
export function debtPaid(debtId: string, transactions: Transaction[]): { cents: Cents; count: number } {
  let cents = 0;
  let count = 0;
  for (const tx of transactions) {
    if (tx.debtId === debtId && isDebtPayment(tx)) {
      cents += tx.amountCents;
      count += 1;
    }
  }
  return { cents, count };
}

/** Cronograma: parcela n = split_cents(total, N)[n], vencendo (1º vencimento + n-1 meses, dia limitado ao mês). */
export function debtSchedule(debt: Pick<Debt, "totalCents" | "installments" | "firstDueDate">) {
  if (!debt.installments || !debt.firstDueDate) return [];
  const first = debt.firstDueDate;
  return splitCents(debt.totalCents, debt.installments).map((amountCents, index) => ({
    number: index + 1,
    dueDate: addMonths(first, index),
    amountCents,
  }));
}

/** Aloca os pagamentos nas parcelas em ordem (cascata). Quitada por acordo ou cancelada: nada em aberto. */
export function debtInstallments(debt: Debt, paidCents: Cents, today: ISODate): DebtInstallment[] {
  const closed = !!debt.settledAt || debt.status === "canceled";
  let before = 0;
  return debtSchedule(debt).map((s) => {
    const covered = Math.min(s.amountCents, Math.max(0, paidCents - before));
    before += s.amountCents;
    const openCents = closed ? 0 : s.amountCents - covered;
    return {
      debtId: debt.id,
      number: s.number,
      dueDate: s.dueDate,
      amountCents: s.amountCents,
      paidCents: covered,
      openCents,
      status: closed || openCents === 0 ? "paid" : covered > 0 ? "partial" : "open",
      overdue: !closed && openCents > 0 && debt.status === "active" && s.dueDate < today,
    };
  });
}

export function debtSummary(debt: Debt, paid: { cents: Cents; count: number }, installments: DebtInstallment[]): DebtSummary {
  const remainingCents = debt.settledAt || debt.status === "canceled" ? 0 : Math.max(debt.totalCents - paid.cents, 0);
  const open = installments.filter((i) => i.openCents > 0);
  const progress = debt.settledAt
    ? 100
    : debt.status === "canceled"
      ? 0
      : Math.round(Math.min((paid.cents * 100) / debt.totalCents, 100) * 100) / 100;
  return {
    debtId: debt.id,
    principalCents: debt.principalCents,
    totalCents: debt.totalCents,
    paidCents: paid.cents,
    remainingCents,
    financialCostCents: debt.totalCents - debt.principalCents,
    progressPercent: progress,
    installmentsCount: debt.installments ?? null,
    installmentsPaid: installments.filter((i) => i.paidCents >= i.amountCents).length,
    installmentsOpen: open.length,
    nextDueDate: open[0]?.dueDate,
    nextOpenCents: open[0]?.openCents,
    paymentsCount: paid.count,
    settledAt: debt.settledAt,
    settlementDiscountCents: debt.settlementDiscountCents,
    status:
      debt.status === "canceled"
        ? "canceled"
        : debt.settledAt || Math.max(debt.totalCents - paid.cents, 0) === 0
          ? "paid"
          : debt.status === "paused"
            ? "paused"
            : "active",
  };
}

/** Resumos e parcelas de todas as dívidas, derivados das transações (modo local). */
export function deriveDebtViews(debts: Debt[], transactions: Transaction[], today: ISODate) {
  const summaries: DebtSummary[] = [];
  const installments: DebtInstallment[] = [];
  for (const debt of debts) {
    const paid = debtPaid(debt.id, transactions);
    const rows = debtInstallments(debt, paid.cents, today);
    installments.push(...rows);
    summaries.push(debtSummary(debt, paid, rows));
  }
  return { summaries, installments };
}

/** Parcelas em aberto que contam no "Disponível de verdade": dívida ATIVA, vencimento até o mês exibido (inclui atrasadas). */
export function openDebtInstallments(
  summaries: DebtSummary[],
  installments: DebtInstallment[],
  month: string,
  allowedDebtIds?: Set<string>,
): DebtInstallment[] {
  const active = new Set(summaries.filter((s) => s.status === "active").map((s) => s.debtId));
  return installments.filter(
    (i) => i.openCents > 0 && active.has(i.debtId) && i.dueDate.slice(0, 7) <= month && (!allowedDebtIds || allowedDebtIds.has(i.debtId)),
  );
}

import { addMonths, dateWithDay, shiftYearMonth, yearMonth } from "./dates";
import type {
  Account,
  Category,
  Cents,
  CreditCard,
  ISODate,
  Transaction,
  TransactionStatus,
} from "./types";

/**
 * Regras financeiras puras: sem I/O, sem React. Única fonte das fórmulas.
 *
 * Quatro impactos distintos (nunca misturar):
 *  1. SALDO da conta ........ balanceDelta / accountBalance
 *  2. DESPESAS .............. isRealizedExpense / monthBreakdown   (competência)
 *  3. FATURA / LIMITE ....... invoiceCycle / cardInvoices / cardUsedLimit
 *  4. PATRIMÔNIO ............ computeBalances (soma de saldos; transferência é neutra)
 */

export const sum = (values: Cents[]): Cents => values.reduce((total, v) => total + v, 0);

export { yearMonth };

// ---------- Classificação ----------

export const isCardPurchase = (tx: Transaction) => tx.kind === "credit_card_purchase";

/**
 * Gera despesa nos relatórios: despesa, compra no cartão e PAGAMENTO DE DÍVIDA (saída real de dinheiro, com
 * classificação própria "Dívidas" para não parecer uma compra nova). Pagamento de fatura e transferência NÃO entram.
 * A dívida em si (contrato) e as parcelas (obrigações derivadas) nunca são somadas — só os pagamentos.
 */
export const isExpenseLike = (tx: Transaction) =>
  tx.kind === "expense" || tx.kind === "credit_card_purchase" || tx.kind === "debt_payment";

export const isOpen = (tx: Transaction) =>
  tx.status === "planned" || tx.status === "pending" || tx.status === "overdue";

/**
 * Status efetivo (derivado):
 * - pendente com vencimento passado -> atrasado;
 * - compra no cartão "prevista" cuja data já chegou -> pendente (está na fatura).
 */
export function effectiveStatus(tx: Transaction, today: ISODate): TransactionStatus {
  if (tx.status === "pending" && tx.dueDate && tx.dueDate < today) return "overdue";
  if (tx.status === "planned" && isCardPurchase(tx) && tx.date <= today) return "pending";
  return tx.status;
}

// ---------- 1. Saldo ----------

/** Efeito de uma movimentação no saldo de uma conta. Só movimentações PAGAS movem saldo. */
export function balanceDelta(tx: Transaction, accountId: string): Cents {
  // Compra no cartão nunca mexe no saldo: o dinheiro só sai quando a fatura é paga.
  if (tx.status !== "paid" || isCardPurchase(tx)) return 0;
  let delta = 0;
  if (tx.accountId === accountId) delta += tx.kind === "income" ? tx.amountCents : -tx.amountCents;
  if (tx.toAccountId === accountId) delta += tx.amountCents;
  return delta;
}

/** Saldo atual = saldo inicial + movimentações pagas que impactam a conta. */
export function accountBalance(account: Account, transactions: Transaction[]): Cents {
  return account.initialBalanceCents + sum(transactions.map((tx) => balanceDelta(tx, account.id)));
}

// ---------- 4. Patrimônio ----------

/**
 * - Só entram contas ATIVAS marcadas para "incluir no patrimônio".
 * - Saldo em contas = contas que NÃO são de investimento.
 * - Investimentos   = contas do tipo investimento.
 * - Patrimônio financeiro = saldo em contas + investimentos.
 * Transferir entre contas só move valor entre as duas parcelas: o total não muda.
 */
export function computeBalancesFrom(accounts: Account[], balanceOf: (account: Account) => Cents) {
  const counted = accounts.filter((a) => a.active && a.includeInNetWorth);
  const total = (list: Account[]) => sum(list.map(balanceOf));
  const accountsCents = total(counted.filter((a) => a.type !== "investment"));
  const investmentsCents = total(counted.filter((a) => a.type === "investment"));
  return { accountsCents, investmentsCents, netWorthCents: accountsCents + investmentsCents };
}

/** Versão que calcula o saldo de cada conta a partir das movimentações (modo local). */
export function computeBalances(accounts: Account[], transactions: Transaction[]) {
  return computeBalancesFrom(accounts, (a) => accountBalance(a, transactions));
}

/** Categoria raiz (subcategoria -> pai). Usada para agrupar relatórios. */
export function rootCategory(categoryId: string | undefined, categories: Map<string, Category>) {
  const category = categoryId ? categories.get(categoryId) : undefined;
  if (category?.parentId) return categories.get(category.parentId) ?? category;
  return category;
}

// ---------- 3. Fatura e limite do cartão ----------

export interface InvoiceCycle {
  closingDate: ISODate;
  dueDate: ISODate;
  /** "YYYY-MM" do vencimento — identifica a fatura. */
  dueMonth: string;
}

/**
 * Fatura em que uma compra cai (ÚNICO lugar com essa regra).
 * - Compra até o dia de fechamento (inclusive) entra na fatura que fecha neste mês.
 * - Compra após o fechamento entra na fatura que fecha no mês seguinte.
 * - Vencimento: se o dia de vencimento é maior que o de fechamento, é no mesmo mês do
 *   fechamento; senão, no mês seguinte.
 * Ex.: fecha dia 20, vence dia 27 -> compra 15/10 fecha 20/10 vence 27/10; compra 22/10 vence 27/11.
 */
export function invoiceCycle(card: Pick<CreditCard, "closingDay" | "dueDay">, purchaseDate: ISODate): InvoiceCycle {
  const [year, month, day] = purchaseDate.split("-").map(Number);
  const closeIndex = year * 12 + (month - 1) + (day > card.closingDay ? 1 : 0);
  const dueIndex = closeIndex + (card.dueDay <= card.closingDay ? 1 : 0);
  const closingDate = dateWithDay(Math.floor(closeIndex / 12), (closeIndex % 12) + 1, card.closingDay);
  const dueDate = dateWithDay(Math.floor(dueIndex / 12), (dueIndex % 12) + 1, card.dueDay);
  return { closingDate, dueDate, dueMonth: yearMonth(dueDate) };
}

export const invoiceDueDate = (card: Pick<CreditCard, "closingDay" | "dueDay">, purchaseDate: ISODate) =>
  invoiceCycle(card, purchaseDate).dueDate;

/** Data da compra original de uma parcela (para saber se já "aconteceu"). */
export function installmentPurchaseDate(tx: Transaction): ISODate {
  if (!tx.installment) return tx.date;
  return tx.installment.purchaseDate ?? addMonths(tx.date, -(tx.installment.number - 1));
}

/** Compra que já consome limite: feita até hoje (parcelas incluídas, mesmo as futuras). */
export function isCommittedPurchase(tx: Transaction, today: ISODate): boolean {
  if (!isCardPurchase(tx) || tx.status === "canceled") return false;
  return installmentPurchaseDate(tx) <= today;
}

export interface Invoice {
  cardId: string;
  dueMonth: string;
  dueDate: ISODate;
  closingDate: ISODate;
  /** Soma das compras (não canceladas) desta fatura. */
  totalCents: Cents;
  /** Soma dos pagamentos de fatura registrados para ela. */
  paidCents: Cents;
  /** Em aberto = total - pago (nunca negativo). */
  openCents: Cents;
  /** Totalmente paga. */
  paid: boolean;
}

export const invoiceKey = (cardId: string, dueMonth: string) => `${cardId}|${dueMonth}`;

/** Faturas de um cartão, derivadas das compras e dos pagamentos. Ordenadas por vencimento. */
export function cardInvoices(card: CreditCard, transactions: Transaction[]): Invoice[] {
  const map = new Map<string, Invoice>();
  const ensure = (dueMonth: string, cycle?: InvoiceCycle): Invoice => {
    let invoice = map.get(dueMonth);
    if (!invoice) {
      const year = +dueMonth.slice(0, 4);
      const month = +dueMonth.slice(5);
      const dueDate = cycle?.dueDate ?? dateWithDay(year, month, card.dueDay);
      const closingDate = cycle?.closingDate ?? dateWithDay(year, month, card.closingDay);
      invoice = { cardId: card.id, dueMonth, dueDate, closingDate, totalCents: 0, paidCents: 0, openCents: 0, paid: false };
      map.set(dueMonth, invoice);
    }
    return invoice;
  };

  for (const tx of transactions) {
    if (tx.cardId !== card.id || tx.status === "canceled") continue;
    if (isCardPurchase(tx)) {
      const cycle = invoiceCycle(card, tx.date);
      ensure(cycle.dueMonth, cycle).totalCents += tx.amountCents;
    } else if (tx.kind === "card_payment" && tx.status === "paid" && tx.invoiceMonth) {
      ensure(tx.invoiceMonth).paidCents += tx.amountCents;
    }
  }

  return [...map.values()]
    .map((inv) => {
      const openCents = Math.max(0, inv.totalCents - inv.paidCents);
      return { ...inv, openCents, paid: inv.totalCents > 0 && openCents === 0 };
    })
    .sort((a, b) => a.dueMonth.localeCompare(b.dueMonth));
}

/** Índice de todas as faturas de todos os cartões (para consulta por cartão+mês). */
export function invoiceIndex(cards: CreditCard[], transactions: Transaction[]): Map<string, Invoice> {
  const index = new Map<string, Invoice>();
  for (const card of cards) {
    for (const invoice of cardInvoices(card, transactions)) index.set(invoiceKey(card.id, invoice.dueMonth), invoice);
  }
  return index;
}

/** Valor em aberto da fatura que vence em `dueMonth`. */
export function cardInvoiceTotal(card: CreditCard, transactions: Transaction[], dueMonth: string): Cents {
  return cardInvoices(card, transactions).find((i) => i.dueMonth === dueMonth)?.openCents ?? 0;
}

/**
 * Limite utilizado = compras já realizadas (inclui parcelas futuras de compras parceladas)
 * menos pagamentos de fatura. Pagar a fatura libera limite; compra apenas prevista não consome.
 */
export function cardUsedLimit(card: CreditCard, transactions: Transaction[], today: ISODate): Cents {
  const purchases = sum(
    transactions.filter((tx) => tx.cardId === card.id && isCommittedPurchase(tx, today)).map((tx) => tx.amountCents),
  );
  const payments = sum(
    transactions
      .filter((tx) => tx.cardId === card.id && tx.kind === "card_payment" && tx.status === "paid")
      .map((tx) => tx.amountCents),
  );
  return Math.max(0, purchases - payments);
}

export interface CardSummary {
  limitCents: Cents;
  usedCents: Cents;
  availableCents: Cents;
  /** Fatura do ciclo de hoje (ainda recebendo compras). */
  current: Invoice;
  /** Ciclo seguinte. */
  next: Invoice;
  /** Faturas já fechadas e ainda em aberto (a pagar). */
  closedOpen: Invoice[];
  /** Todas as faturas com valor em aberto, da mais antiga para a mais nova. */
  payable: Invoice[];
}

/** Resumo do cartão a partir de faturas e limite JÁ calculados (snapshot: views do banco ou derivado). */
export function cardSummaryFrom(card: CreditCard, invoices: Invoice[], usedCents: Cents, today: ISODate): CardSummary {
  const currentMonth = invoiceCycle(card, today).dueMonth;
  const nextMonth = shiftYearMonth(currentMonth, 1);
  const pick = (dueMonth: string): Invoice =>
    invoices.find((i) => i.dueMonth === dueMonth) ?? {
      cardId: card.id,
      dueMonth,
      dueDate: dateWithDay(+dueMonth.slice(0, 4), +dueMonth.slice(5), card.dueDay),
      closingDate: dateWithDay(+dueMonth.slice(0, 4), +dueMonth.slice(5), card.closingDay),
      totalCents: 0,
      paidCents: 0,
      openCents: 0,
      paid: false,
    };
  return {
    limitCents: card.limitCents,
    usedCents,
    availableCents: card.limitCents - usedCents,
    current: pick(currentMonth),
    next: pick(nextMonth),
    closedOpen: invoices.filter((i) => i.closingDate < today && i.openCents > 0),
    payable: invoices.filter((i) => i.openCents > 0),
  };
}

export function cardSummary(card: CreditCard, transactions: Transaction[], today: ISODate): CardSummary {
  return cardSummaryFrom(card, cardInvoices(card, transactions), cardUsedLimit(card, transactions, today), today);
}

/** Mês de vencimento da fatura de uma compra: o que o banco gravou (invoiceMonth) ou, no modo local, o ciclo. */
export const purchaseInvoiceMonth = (card: Pick<CreditCard, "closingDay" | "dueDay">, tx: Transaction) =>
  tx.invoiceMonth ?? invoiceCycle(card, tx.date).dueMonth;

/**
 * Status para exibição. Compra no cartão aparece como "paga" quando a fatura inteira foi paga
 * (o status gravado da compra nunca muda: a verdade está nos pagamentos de fatura).
 */
export function displayStatus(
  tx: Transaction,
  today: ISODate,
  cards: Map<string, CreditCard>,
  invoices: Map<string, Invoice>,
): TransactionStatus {
  const status = effectiveStatus(tx, today);
  if (isCardPurchase(tx) && status !== "canceled" && tx.cardId) {
    const card = cards.get(tx.cardId);
    if (card && invoices.get(invoiceKey(card.id, purchaseInvoiceMonth(card, tx)))?.paid) return "paid";
  }
  return status;
}

// ---------- 2. Despesas (competência) ----------

/**
 * Despesa realizada (já aconteceu):
 * - despesa em conta: quando está paga;
 * - compra no cartão: na data da compra (mesmo com a fatura em aberto). Pagar a fatura depois
 *   NÃO gera nova despesa — por isso card_payment nunca é isExpenseLike.
 */
export function isRealizedExpense(tx: Transaction, today: ISODate): boolean {
  if (!isExpenseLike(tx)) return false;
  const status = effectiveStatus(tx, today);
  if (tx.kind === "expense" || tx.kind === "debt_payment") return status === "paid";
  return status !== "planned" && status !== "canceled" && tx.date <= today;
}

export interface MonthBreakdown {
  /** Receitas já recebidas no mês. */
  incomeReceivedCents: Cents;
  /** Receitas pendentes/previstas no mês. */
  incomeOpenCents: Cents;
  /** Despesas realizadas (base do card "Despesas" e do gráfico por categoria). */
  realizedExpenses: Transaction[];
  realizedCents: Cents;
  /** A pagar neste mês (contas pendentes/atrasadas). */
  pendingCents: Cents;
  /** Futuras/previstas. */
  plannedCents: Cents;
}

/** Resumo de um conjunto de movimentações dentro de um mês (por data de competência). */
export function monthBreakdown(transactions: Transaction[], month: string, today: ISODate): MonthBreakdown {
  const inMonth = transactions.filter((t) => yearMonth(t.date) === month && t.status !== "canceled");

  const incomes = inMonth.filter((t) => t.kind === "income");
  const expenses = inMonth.filter(isExpenseLike);
  const realizedExpenses = expenses.filter((t) => isRealizedExpense(t, today));
  const notRealized = expenses.filter((t) => !isRealizedExpense(t, today));

  return {
    incomeReceivedCents: sum(incomes.filter((t) => t.status === "paid").map((t) => t.amountCents)),
    incomeOpenCents: sum(incomes.filter(isOpen).map((t) => t.amountCents)),
    realizedExpenses,
    realizedCents: sum(realizedExpenses.map((t) => t.amountCents)),
    pendingCents: sum(
      notRealized.filter((t) => ["pending", "overdue"].includes(effectiveStatus(t, today))).map((t) => t.amountCents),
    ),
    plannedCents: sum(notRealized.filter((t) => effectiveStatus(t, today) === "planned").map((t) => t.amountCents)),
  };
}

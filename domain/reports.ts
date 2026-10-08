import {
  balanceDelta,
  computeBalancesFrom,
  effectiveStatus,
  isCardPurchase,
  isRealizedExpense,
  rootCategory,
  sum,
} from "./calculations";
import { goalProgress, signedCents, type GoalProgress } from "./pockets";
import { monthEnd } from "./dates";
import { monthsOf, type Period } from "./report-periods";
import { snapshotBalance, snapshotOf, snapshotPocketBalance, snapshotReserved, snapshotUsedLimit } from "./snapshot";
import type {
  Account,
  Category,
  Cents,
  CreditCard,
  Debt,
  FinancialProfile,
  Goal,
  ID,
  ISODate,
  Pocket,
  PocketMovement,
  Transaction,
  TransactionKind,
  WorkspaceData,
} from "./types";

/**
 * MOTOR DE RELATÓRIOS — funções PURAS sobre os dados do workspace (nada é gravado, nenhuma segunda cópia dos dados).
 * O mesmo motor serve o modo local e o Supabase: ele só recebe as movimentações CARREGADAS para o período + o snapshot
 * (saldos, faturas, dívidas, reservas) e os movimentos de cofrinhos.
 *
 * DUAS LENTES (nunca misturadas):
 *
 *  A) FLUXO DE CAIXA — dinheiro que realmente entrou/saiu das contas, na DATA DO PAGAMENTO (paidAt ?? date):
 *       entradas = receitas pagas
 *       saídas   = despesas pagas em conta + PAGAMENTOS DE FATURA + PAGAMENTOS DE DÍVIDA
 *       compra no cartão NÃO sai da conta na data da compra (sai quando a fatura é paga)
 *       transferência / investimento / resgate entre contas próprias: NEUTROS (nem entrada nem saída)
 *
 *  B) CONSUMO — gasto econômico, na DATA DE COMPETÊNCIA (date), sem dupla contagem:
 *       consumo = despesas em conta + compras no cartão (cada parcela na sua data)
 *       NÃO entram: pagamento de fatura, transferências, reserva/retirada de cofrinho
 *       pagamento de dívida: seção própria ("Pagamentos de dívidas"), fora do consumo (principal × juros ainda não é
 *       decomposto; nada é estimado)
 *
 * O uso de reserva de cofrinho cria UMA despesa (consumo + saída de caixa) e o estorno a cancela: nenhum movimento de
 * cofrinho entra sozinho em receita, consumo ou caixa.
 */

export type StatusFilter = "all" | "realized" | "open" | "planned";

export interface ReportFilters {
  period: Period;
  /** "all" = consolidado do household (cada movimentação tem UM dono: nada é contado duas vezes). */
  profileId: ID | "all";
  accountId: ID | "all";
  cardId: ID | "all";
  /** Categoria raiz OU subcategoria. */
  categoryId: ID | "all";
  kind: TransactionKind | "all";
  status: StatusFilter;
}

export const ALL = "all" as const;

export const defaultFilters = (period: Period): ReportFilters => ({
  period,
  profileId: ALL,
  accountId: ALL,
  cardId: ALL,
  categoryId: ALL,
  kind: ALL,
  status: ALL,
});

export interface ReportInput {
  data: WorkspaceData;
  /** Histórico de cofrinhos (todos os tipos). Local: do armazenamento; Supabase: repos.pockets.movements. */
  pocketMovements: PocketMovement[];
  today: ISODate;
}

// ---------------------------------------------------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------------------------------------------------

/** Tipos que só trocam o dinheiro de conta (neutros no consolidado). */
export const INTERNAL_KINDS: readonly TransactionKind[] = ["transfer", "investment", "redemption"];

export type Bucket = "realized" | "open" | "planned" | "canceled";

/** Situação do item para os relatórios (realizado x em aberto x previsto). */
export function bucketOf(tx: Transaction, today: ISODate): Bucket {
  const status = effectiveStatus(tx, today);
  if (status === "canceled") return "canceled";
  if (isCardPurchase(tx)) {
    if (isRealizedExpense(tx, today)) return "realized";
    return status === "planned" ? "planned" : "open";
  }
  if (status === "paid") return "realized";
  if (status === "planned") return "planned";
  return "open"; // pending | overdue
}

/** Data em que o dinheiro se moveu (só faz sentido para itens pagos que mexem em conta). */
export const cashDateOf = (tx: Transaction): ISODate => tx.paidAt ?? tx.date;

export const inPeriod = (date: ISODate, p: Period) => date >= p.from && date <= p.to;

interface Ctx {
  today: ISODate;
  categories: Map<ID, Category>;
  cards: Map<ID, CreditCard>;
  accounts: Map<ID, Account>;
}

/** Filtros comuns (tudo, menos o período, que cada lente aplica na sua data). */
function matches(tx: Transaction, f: ReportFilters, ctx: Ctx): boolean {
  if (f.profileId !== ALL && tx.profileId !== f.profileId) return false;
  if (f.kind !== ALL && tx.kind !== f.kind) return false;
  if (f.cardId !== ALL && tx.cardId !== f.cardId) return false;
  if (f.accountId !== ALL) {
    // Compra no cartão não tem conta: pertence à conta que paga a fatura do cartão.
    const viaCard = isCardPurchase(tx) && !!tx.cardId && ctx.cards.get(tx.cardId)?.accountId === f.accountId;
    if (tx.accountId !== f.accountId && tx.toAccountId !== f.accountId && !viaCard) return false;
  }
  if (f.categoryId !== ALL) {
    const category = tx.categoryId ? ctx.categories.get(tx.categoryId) : undefined;
    if (tx.categoryId !== f.categoryId && category?.parentId !== f.categoryId) return false;
  }
  const bucket = bucketOf(tx, ctx.today);
  if (bucket === "canceled") return false;
  if (f.status === "realized" && bucket !== "realized") return false;
  if (f.status === "open" && bucket !== "open") return false;
  if (f.status === "planned" && bucket !== "planned") return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Quebra por categoria (com drill-down)
// ---------------------------------------------------------------------------------------------------------------------

export interface BreakdownNode {
  id: ID | "none";
  name: string;
  color: string;
  icon: string;
  totalCents: Cents;
  /** Participação no total do conjunto (0–100, 1 casa). */
  percent: number;
  count: number;
  /** Subcategorias (ou "Sem subcategoria"); a soma dos filhos = total do nó. */
  children: BreakdownNode[];
  /** Movimentações que compõem o valor (para o drill-down), mais recentes primeiro. */
  transactions: Transaction[];
}

const NONE = { id: "none" as const, name: "Sem categoria", color: "#94a3b8", icon: "more" };
const byDateDesc = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

/** Agrupa por categoria raiz; os filhos são as subcategorias. Soma dos nós === soma das movimentações (centavo a centavo). */
export function categoryBreakdown(txs: Transaction[], categories: Map<ID, Category>): BreakdownNode[] {
  const total = sum(txs.map((t) => t.amountCents));
  const roots = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const key = rootCategory(tx.categoryId, categories)?.id ?? NONE.id;
    roots.set(key, [...(roots.get(key) ?? []), tx]);
  }
  const node = (id: string, list: Transaction[], parentTotal: number, isChild: boolean): BreakdownNode => {
    const category = id === NONE.id ? undefined : categories.get(id);
    const totalCents = sum(list.map((t) => t.amountCents));
    return {
      id: id as ID,
      name: category?.name ?? (isChild ? "Sem subcategoria" : NONE.name),
      color: category?.color ?? NONE.color,
      icon: category?.icon ?? NONE.icon,
      totalCents,
      percent: pct(totalCents, parentTotal),
      count: list.length,
      children: [],
      transactions: [...list].sort(byDateDesc),
    };
  };
  return [...roots.entries()]
    .map(([rootId, list]) => {
      const parent = node(rootId, list, total, false);
      const kids = new Map<string, Transaction[]>();
      for (const tx of list) {
        const key = tx.categoryId && tx.categoryId !== rootId ? tx.categoryId : `${rootId}#self`;
        kids.set(key, [...(kids.get(key) ?? []), tx]);
      }
      // Só detalha quando há mais de um grupo (ou quando há subcategoria de fato).
      const hasSub = [...kids.keys()].some((k) => !k.endsWith("#self"));
      if (hasSub) {
        parent.children = [...kids.entries()]
          .map(([key, l]) => {
            const n = node(key.endsWith("#self") ? rootId : key, l, parent.totalCents, true);
            if (key.endsWith("#self")) {
              n.name = rootId === NONE.id ? NONE.name : `${categories.get(rootId)?.name ?? "—"} (sem subcategoria)`;
            }
            return n;
          })
          .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, "pt-BR"));
      }
      return parent;
    })
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, "pt-BR"));
}

// ---------------------------------------------------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------------------------------------------------

export interface MonthPoint {
  month: string;
  incomeCents: Cents;
  consumptionCents: Cents;
  cashInCents: Cents;
  cashOutCents: Cents;
  cashNetCents: Cents;
}

export interface Overview {
  /** Receitas pagas (recebidas) cuja competência cai no período. */
  receivedCents: Cents;
  /** Despesas de consumo realizadas (despesas em conta pagas + compras no cartão já ocorridas) no período. */
  consumptionCents: Cents;
  /** Pagamentos de dívida realizados no período (fora do consumo). */
  debtPaymentsCents: Cents;
  /** Saídas de caixa: despesas pagas + pagamentos de fatura + pagamentos de dívida, pela data de pagamento. */
  cashOutCents: Cents;
  /** Entradas de caixa: receitas pagas pela data de pagamento. */
  cashInCents: Cents;
  /** Resultado do período = recebido − consumo − pagamentos de dívida. */
  resultCents: Cents;
  /** Taxa de economia = resultado / recebido (null sem receita). */
  savingsRate: number | null;
  /** Saldo atual das contas (sem investimentos) no escopo — fotografia de HOJE. */
  currentBalanceCents: Cents;
  /** Patrimônio financeiro (contas + investimentos) de HOJE no escopo. */
  netWorthFinancialCents: Cents;
  /** Total reservado em cofrinhos de HOJE no escopo (informativo; NÃO altera patrimônio). */
  reservedCents: Cents;
  /** Dívidas restantes (contratos ativos/pausados) de HOJE no escopo. */
  debtRemainingCents: Cents;
}

export interface IncomeReport {
  receivedCents: Cents;
  /** Previsto/em aberto (a receber) no período. */
  expectedCents: Cents;
  recurringCents: Cents;
  oneOffCents: Cents;
  byCategory: BreakdownNode[];
  byProfile: { profileId: ID; name: string; color: string; totalCents: Cents; percent: number }[];
  rows: Transaction[];
}

export interface ExpensesReport {
  /** Consumo realizado. */
  consumptionCents: Cents;
  /** Consumo ainda não realizado: contas a pagar/compras previstas (informativo). */
  openCents: Cents;
  byCategory: BreakdownNode[];
  /** Cada linha é uma movimentação que compõe o consumo. */
  rows: Transaction[];
  debtPayments: { totalCents: Cents; count: number; byDebt: { debtId: ID | "none"; name: string; totalCents: Cents; count: number }[]; rows: Transaction[] };
}

export interface CashFlowReport {
  inCents: Cents;
  outCents: Cents;
  netCents: Cents;
  /** Composição das saídas. */
  outBreakdown: { expenseCents: Cents; cardPaymentsCents: Cents; debtPaymentsCents: Cents };
  /** Transferências entre contas que cruzam o ESCOPO (neutras no consolidado → 0). Informativo; fora de entradas/saídas. */
  transfersInCents: Cents;
  transfersOutCents: Cents;
  months: MonthPoint[];
  rows: { tx: Transaction; direction: "in" | "out"; date: ISODate }[];
}

export interface CardReport {
  card: CreditCard;
  /** Compras (competência) no período. */
  spentCents: Cents;
  purchases: Transaction[];
  byCategory: BreakdownNode[];
  invoices: { dueMonth: string; totalCents: Cents; paidCents: Cents; openCents: Cents; paid: boolean }[];
  limitCents: Cents;
  usedCents: Cents;
  availableCents: Cents;
  installmentPurchasesCents: Cents;
  installmentCount: number;
  upcomingInstallments: { tx: Transaction; date: ISODate }[];
  upcomingInstallmentsCents: Cents;
}

export interface DebtReportRow {
  debt: Debt;
  principalCents: Cents;
  totalCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
  financialCostCents: Cents;
  progressPercent: number;
  status: string;
  /** Pagamentos realizados NO período (caixa). */
  paymentsInPeriodCents: Cents;
  paymentsInPeriodCount: number;
  futureInstallmentsCents: Cents;
  futureInstallmentsCount: number;
  settledAt?: ISODate;
  settlementDiscountCents?: Cents;
}

export interface DebtsReport {
  rows: DebtReportRow[];
  principalCents: Cents;
  totalCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
  financialCostCents: Cents;
  paymentsInPeriodCents: Cents;
  discountsCents: Cents;
  futureInstallmentsCents: Cents;
}

export interface NetWorthPoint {
  month: string;
  date: ISODate;
  accountsCents: Cents;
  investmentsCents: Cents;
  totalCents: Cents;
}

export interface NetWorthReport {
  /** Contas ativas marcadas "incluir no patrimônio", no escopo. */
  assets: { accountId: ID; name: string; type: Account["type"]; balanceCents: Cents }[];
  accountsCents: Cents;
  investmentsCents: Cents;
  /** Patrimônio financeiro = contas + investimentos. Cofrinhos NÃO entram (são divisão virtual do mesmo dinheiro). */
  financialCents: Cents;
  /** Passivo considerado: saldo restante das dívidas ativas/pausadas. */
  debtsCents: Cents;
  /** Patrimônio líquido = patrimônio financeiro − dívidas restantes. */
  netCents: Cents;
  /** Informativo (NÃO deduzido): faturas de cartão em aberto. */
  openInvoicesCents: Cents;
  months: NetWorthPoint[];
}

export interface PocketsReport {
  reservedCents: Cents;
  byPocket: { pocket: Pocket; balanceCents: Cents; percent: number }[];
  /** Reservado ao fim de cada mês (reconstruído a partir do histórico). */
  months: { month: string; reservedCents: Cents }[];
  /** Movimento líquido de reservas no período (reservas − retiradas − usos + estornos...). */
  periodMovementCents: Cents;
  goals: {
    goal: Goal;
    progress: GoalProgress;
    daysLeft?: number;
    state: "completed" | "late" | "near" | "ongoing" | "paused" | "canceled";
  }[];
}

export interface ProfileRow {
  profileId: ID | "all";
  name: string;
  color?: string;
  receivedCents: Cents;
  consumptionCents: Cents;
  debtPaymentsCents: Cents;
  cashInCents: Cents;
  cashOutCents: Cents;
}

export interface Report {
  filters: ReportFilters;
  today: ISODate;
  overview: Overview;
  income: IncomeReport;
  expenses: ExpensesReport;
  cashFlow: CashFlowReport;
  cards: CardReport[];
  debts: DebtsReport;
  netWorth: NetWorthReport;
  pockets: PocketsReport;
  /** Movimentações do período (qualquer lente) que passam nos filtros — base do CSV de movimentações. */
  movements: Transaction[];
  /** Pessoa A, Pessoa B, Casal… e o consolidado (soma dos perfis). */
  profiles: ProfileRow[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------------------------------------------------

const monthEndCapped = (month: string, today: ISODate) => {
  const end = monthEnd(month);
  return end > today ? today : end;
};

export function buildReport(input: ReportInput, filters: ReportFilters): Report {
  const { data, pocketMovements, today } = input;
  const snapshot = snapshotOf(data, today);
  const ctx: Ctx = {
    today,
    categories: new Map(data.categories.map((c) => [c.id, c])),
    cards: new Map(data.creditCards.map((c) => [c.id, c])),
    accounts: new Map(data.accounts.map((a) => [a.id, a])),
  };
  const f = filters;
  const months = monthsOf(f.period);
  const all = data.transactions.filter((t) => matches(t, f, ctx));

  // ----- lentes -----
  const incomeRows = all.filter((t) => t.kind === "income" && inPeriod(t.date, f.period));
  const consumptionAll = all.filter((t) => (t.kind === "expense" || isCardPurchase(t)) && inPeriod(t.date, f.period));
  const consumptionRealized = consumptionAll.filter((t) => bucketOf(t, today) === "realized");
  const consumptionOpen = consumptionAll.filter((t) => bucketOf(t, today) !== "realized");
  const debtRows = all.filter((t) => t.kind === "debt_payment" && inPeriod(t.date, f.period));
  const debtRealized = debtRows.filter((t) => bucketOf(t, today) === "realized");

  const cashRows = all.filter(
    (t) => bucketOf(t, today) === "realized" && !isCardPurchase(t) && !INTERNAL_KINDS.includes(t.kind) && inPeriod(cashDateOf(t), f.period),
  );
  const cashIn = cashRows.filter((t) => t.kind === "income");
  const cashOut = cashRows.filter((t) => t.kind !== "income");

  // ----- escopo de contas (para fotografias de hoje) -----
  const scopeAccounts = data.accounts.filter(
    (a) => (f.profileId === ALL || a.ownerProfileId === f.profileId) && (f.accountId === ALL || a.id === f.accountId),
  );
  const scopeIds = new Set(scopeAccounts.map((a) => a.id));
  const balances = computeBalancesFrom(scopeAccounts, (a) => snapshotBalance(snapshot, a));
  const scopeDebts = data.debts.filter((d) => f.profileId === ALL || d.profileId === f.profileId);

  // ----- transferências que cruzam o escopo (informativo) -----
  const transfers = data.transactions.filter(
    (t) => INTERNAL_KINDS.includes(t.kind) && t.status === "paid" && inPeriod(cashDateOf(t), f.period) && (f.kind === ALL || f.kind === t.kind),
  );
  const transfersIn = sum(transfers.filter((t) => t.toAccountId && scopeIds.has(t.toAccountId) && !(t.accountId && scopeIds.has(t.accountId))).map((t) => t.amountCents));
  const transfersOut = sum(transfers.filter((t) => t.accountId && scopeIds.has(t.accountId) && !(t.toAccountId && scopeIds.has(t.toAccountId))).map((t) => t.amountCents));

  // ----- série mensal -----
  const monthPoints: MonthPoint[] = months.map((month) => {
    const inM = (d: ISODate) => d.slice(0, 7) === month && inPeriod(d, f.period);
    const incomeCents = sum(incomeRows.filter((t) => bucketOf(t, today) === "realized" && inM(t.date)).map((t) => t.amountCents));
    const consumptionCents = sum(consumptionRealized.filter((t) => inM(t.date)).map((t) => t.amountCents));
    const cashInCents = sum(cashIn.filter((t) => inM(cashDateOf(t))).map((t) => t.amountCents));
    const cashOutCents = sum(cashOut.filter((t) => inM(cashDateOf(t))).map((t) => t.amountCents));
    return { month, incomeCents, consumptionCents, cashInCents, cashOutCents, cashNetCents: cashInCents - cashOutCents };
  });

  // ----- visão geral -----
  const receivedCents = sum(incomeRows.filter((t) => bucketOf(t, today) === "realized").map((t) => t.amountCents));
  const consumptionCents = sum(consumptionRealized.map((t) => t.amountCents));
  const debtPaymentsCents = sum(debtRealized.map((t) => t.amountCents));
  const resultCents = receivedCents - consumptionCents - debtPaymentsCents;
  const reservedScope = sum(scopeAccounts.filter((a) => a.active && a.type !== "investment").map((a) => snapshotReserved(snapshot, a.id)));
  const debtRemaining = sum(
    scopeDebts.map((d) => snapshot.debts.find((s) => s.debtId === d.id)).filter((s) => s && (s.status === "active" || s.status === "paused")).map((s) => s!.remainingCents),
  );
  const overview: Overview = {
    receivedCents,
    consumptionCents,
    debtPaymentsCents,
    cashOutCents: sum(cashOut.map((t) => t.amountCents)),
    cashInCents: sum(cashIn.map((t) => t.amountCents)),
    resultCents,
    savingsRate: receivedCents > 0 ? Math.round((resultCents / receivedCents) * 1000) / 10 : null,
    currentBalanceCents: balances.accountsCents,
    netWorthFinancialCents: balances.netWorthCents,
    reservedCents: reservedScope,
    debtRemainingCents: debtRemaining,
  };

  // ----- receitas -----
  const profiles = new Map(data.profiles.map((p) => [p.id, p]));
  const incomeRealized = incomeRows.filter((t) => bucketOf(t, today) === "realized");
  const byProfileMap = new Map<ID, Cents>();
  for (const t of incomeRealized) byProfileMap.set(t.profileId, (byProfileMap.get(t.profileId) ?? 0) + t.amountCents);
  const income: IncomeReport = {
    receivedCents,
    expectedCents: sum(incomeRows.filter((t) => bucketOf(t, today) !== "realized").map((t) => t.amountCents)),
    recurringCents: sum(incomeRealized.filter((t) => !!t.recurringId).map((t) => t.amountCents)),
    oneOffCents: sum(incomeRealized.filter((t) => !t.recurringId).map((t) => t.amountCents)),
    byCategory: categoryBreakdown(incomeRealized, ctx.categories),
    byProfile: [...byProfileMap.entries()]
      .map(([profileId, totalCents]) => ({ profileId, name: profiles.get(profileId)?.name ?? "—", color: profiles.get(profileId)?.color ?? "#94a3b8", totalCents, percent: pct(totalCents, receivedCents) }))
      .sort((a, b) => b.totalCents - a.totalCents),
    rows: [...incomeRows].sort(byDateDesc),
  };

  // ----- despesas de consumo -----
  const debtNames = new Map(data.debts.map((d) => [d.id, d.name]));
  const byDebt = new Map<string, { totalCents: Cents; count: number }>();
  for (const t of debtRealized) {
    const key = t.debtId ?? "none";
    const cur = byDebt.get(key) ?? { totalCents: 0, count: 0 };
    byDebt.set(key, { totalCents: cur.totalCents + t.amountCents, count: cur.count + 1 });
  }
  const expenses: ExpensesReport = {
    consumptionCents,
    openCents: sum(consumptionOpen.map((t) => t.amountCents)),
    byCategory: categoryBreakdown(consumptionRealized, ctx.categories),
    rows: [...consumptionRealized].sort(byDateDesc),
    debtPayments: {
      totalCents: debtPaymentsCents,
      count: debtRealized.length,
      byDebt: [...byDebt.entries()]
        .map(([debtId, v]) => ({ debtId: debtId as ID | "none", name: debtId === "none" ? "Sem dívida vinculada" : (debtNames.get(debtId) ?? "—"), ...v }))
        .sort((a, b) => b.totalCents - a.totalCents),
      rows: [...debtRealized].sort(byDateDesc),
    },
  };

  // ----- fluxo de caixa -----
  const cashFlow: CashFlowReport = {
    inCents: overview.cashInCents,
    outCents: overview.cashOutCents,
    netCents: overview.cashInCents - overview.cashOutCents,
    outBreakdown: {
      expenseCents: sum(cashOut.filter((t) => t.kind === "expense").map((t) => t.amountCents)),
      cardPaymentsCents: sum(cashOut.filter((t) => t.kind === "card_payment").map((t) => t.amountCents)),
      debtPaymentsCents: sum(cashOut.filter((t) => t.kind === "debt_payment").map((t) => t.amountCents)),
    },
    transfersInCents: transfersIn,
    transfersOutCents: transfersOut,
    months: monthPoints,
    rows: [
      ...cashIn.map((tx) => ({ tx, direction: "in" as const, date: cashDateOf(tx) })),
      ...cashOut.map((tx) => ({ tx, direction: "out" as const, date: cashDateOf(tx) })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.tx.id.localeCompare(a.tx.id)),
  };

  // ----- cartões -----
  const cards: CardReport[] = data.creditCards
    .filter((c) => (f.profileId === ALL || c.ownerProfileId === f.profileId) && (f.cardId === ALL || c.id === f.cardId) && (f.accountId === ALL || c.accountId === f.accountId))
    .map((card) => {
      const purchases = all.filter((t) => isCardPurchase(t) && t.cardId === card.id && inPeriod(t.date, f.period));
      const realized = purchases.filter((t) => bucketOf(t, today) === "realized");
      const installments = realized.filter((t) => !!t.installment);
      const upcoming = data.transactions
        .filter((t) => isCardPurchase(t) && t.cardId === card.id && !!t.installment && t.date > today && bucketOf(t, today) !== "canceled" && (f.profileId === ALL || t.profileId === f.profileId))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const usedCents = snapshotUsedLimit(snapshot, card);
      return {
        card,
        spentCents: sum(realized.map((t) => t.amountCents)),
        purchases: [...realized].sort(byDateDesc),
        byCategory: categoryBreakdown(realized, ctx.categories),
        invoices: snapshot.invoices
          .filter((i) => i.cardId === card.id && months.includes(i.dueMonth))
          .sort((a, b) => a.dueMonth.localeCompare(b.dueMonth))
          .map((i) => ({ dueMonth: i.dueMonth, totalCents: i.totalCents, paidCents: i.paidCents, openCents: i.openCents, paid: i.paid })),
        limitCents: card.limitCents,
        usedCents,
        availableCents: card.limitCents - usedCents,
        installmentPurchasesCents: sum(installments.map((t) => t.amountCents)),
        installmentCount: installments.length,
        upcomingInstallments: upcoming.slice(0, 12).map((tx) => ({ tx, date: tx.date })),
        upcomingInstallmentsCents: sum(upcoming.map((t) => t.amountCents)),
      };
    });

  // ----- dívidas -----
  const debtRows2: DebtReportRow[] = scopeDebts.map((debt) => {
    const s = snapshot.debts.find((x) => x.debtId === debt.id);
    const installments = snapshot.debtInstallments.filter((i) => i.debtId === debt.id && i.openCents > 0 && i.dueDate > today);
    const inP = data.transactions.filter(
      (t) => t.kind === "debt_payment" && t.debtId === debt.id && t.status === "paid" && inPeriod(cashDateOf(t), f.period) && (f.accountId === ALL || t.accountId === f.accountId),
    );
    return {
      debt,
      principalCents: s?.principalCents ?? debt.principalCents,
      totalCents: s?.totalCents ?? debt.totalCents,
      paidCents: s?.paidCents ?? 0,
      remainingCents: s?.remainingCents ?? debt.totalCents,
      financialCostCents: s?.financialCostCents ?? debt.totalCents - debt.principalCents,
      progressPercent: s?.progressPercent ?? 0,
      status: s?.status ?? debt.status,
      paymentsInPeriodCents: sum(inP.map((t) => t.amountCents)),
      paymentsInPeriodCount: inP.length,
      futureInstallmentsCents: sum(installments.map((i) => i.openCents)),
      futureInstallmentsCount: installments.length,
      settledAt: s?.settledAt,
      settlementDiscountCents: s?.settlementDiscountCents,
    };
  });
  const live = debtRows2.filter((r) => r.status === "active" || r.status === "paused" || r.status === "paid");
  const debts: DebtsReport = {
    rows: debtRows2,
    principalCents: sum(live.map((r) => r.principalCents)),
    totalCents: sum(live.map((r) => r.totalCents)),
    paidCents: sum(live.map((r) => r.paidCents)),
    remainingCents: debtRemaining,
    financialCostCents: sum(live.map((r) => r.financialCostCents)),
    paymentsInPeriodCents: sum(debtRows2.map((r) => r.paymentsInPeriodCents)),
    discountsCents: sum(debtRows2.map((r) => r.settlementDiscountCents ?? 0)),
    futureInstallmentsCents: sum(debtRows2.filter((r) => r.status === "active" || r.status === "paused").map((r) => r.futureInstallmentsCents)),
  };

  // ----- patrimônio (evolução reconstruída a partir do saldo de hoje) -----
  // saldo(fim do mês) = saldo atual − movimentações PAGAS com data de pagamento posterior a esse fim. Só olha o que foi
  // carregado (período em diante): nunca o histórico inteiro.
  const counted = scopeAccounts.filter((a) => a.active && a.includeInNetWorth);
  const paidAfter = (account: Account, end: ISODate) =>
    sum(data.transactions.filter((t) => cashDateOf(t) > end && t.status === "paid").map((t) => balanceDelta(t, account.id)));
  const netMonths: NetWorthPoint[] = months
    .filter((m) => m <= today.slice(0, 7))
    .map((month) => {
      const date = monthEndCapped(month, today);
      const at = (list: Account[]) => sum(list.map((a) => snapshotBalance(snapshot, a) - paidAfter(a, date)));
      const accountsCents = at(counted.filter((a) => a.type !== "investment"));
      const investmentsCents = at(counted.filter((a) => a.type === "investment"));
      return { month, date, accountsCents, investmentsCents, totalCents: accountsCents + investmentsCents };
    });
  const openInvoices = sum(
    snapshot.invoices
      .filter((i) => data.creditCards.some((c) => c.id === i.cardId && (f.profileId === ALL || c.ownerProfileId === f.profileId)))
      .map((i) => i.openCents),
  );
  const netWorth: NetWorthReport = {
    assets: counted.map((a) => ({ accountId: a.id, name: a.name, type: a.type, balanceCents: snapshotBalance(snapshot, a) })),
    accountsCents: balances.accountsCents,
    investmentsCents: balances.investmentsCents,
    financialCents: balances.netWorthCents,
    debtsCents: debtRemaining,
    netCents: balances.netWorthCents - debtRemaining,
    openInvoicesCents: openInvoices,
    months: netMonths,
  };

  // ----- cofrinhos e objetivos -----
  const scopePockets = data.pockets.filter(
    (p) => (f.profileId === ALL || p.profileId === f.profileId) && (f.accountId === ALL || p.accountId === f.accountId),
  );
  const pocketIds = new Set(scopePockets.map((p) => p.id));
  const scopeMovements = pocketMovements.filter((m) => pocketIds.has(m.pocketId));
  const balanceOf = (p: Pocket) => snapshotPocketBalance(snapshot, p);
  const reservedNow = sum(scopePockets.map(balanceOf));
  const pocketMonths = months
    .filter((m) => m <= today.slice(0, 7))
    .map((month) => {
      const end = monthEndCapped(month, today);
      return { month, reservedCents: reservedNow - sum(scopeMovements.filter((m) => m.date > end).map(signedCents)) };
    });
  const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  const balancesMap = snapshot.pocketBalances;
  const pockets: PocketsReport = {
    reservedCents: reservedNow,
    byPocket: scopePockets
      .filter((p) => p.status === "active" || balanceOf(p) !== 0)
      .map((pocket) => ({ pocket, balanceCents: balanceOf(pocket), percent: pct(balanceOf(pocket), reservedNow) }))
      .sort((a, b) => b.balanceCents - a.balanceCents),
    months: pocketMonths,
    periodMovementCents: sum(scopeMovements.filter((m) => inPeriod(m.date, f.period)).map(signedCents)),
    goals: data.goals
      .filter((g) => f.profileId === ALL || g.profileId === f.profileId)
      .map((goal) => {
        const progress = goalProgress(goal, balancesMap);
        const daysLeft = goal.deadline ? daysBetween(today, goal.deadline) : undefined;
        let state: PocketsReport["goals"][number]["state"] = "ongoing";
        if (goal.status === "canceled") state = "canceled";
        else if (goal.status === "paused") state = "paused";
        else if (goal.status === "completed" || progress.reached) state = "completed";
        else if (daysLeft !== undefined && daysLeft < 0) state = "late";
        else if (daysLeft !== undefined && daysLeft <= 60) state = "near";
        return { goal, progress, daysLeft, state };
      })
      .sort((a, b) => (a.goal.deadline ?? "9999").localeCompare(b.goal.deadline ?? "9999") || a.goal.name.localeCompare(b.goal.name, "pt-BR")),
  };

  // ----- movimentações do período (base do CSV; qualquer lente) -----
  const movements = all
    .filter((t) => inPeriod(t.date, f.period) || (t.status === "paid" && !isCardPurchase(t) && inPeriod(cashDateOf(t), f.period)))
    .sort(byDateDesc);

  return {
    filters: f,
    today,
    overview,
    income,
    expenses,
    cashFlow,
    cards,
    debts,
    netWorth,
    pockets,
    movements,
    profiles: profileComparison(input, f),
  };
}

/**
 * Pessoa A, Pessoa B, Casal… e Consolidado. "Casal" é um PERFIL (compartilhado); "Consolidado" é o household inteiro: a
 * soma dos perfis. Cada movimentação pertence a UM perfil, então a soma das linhas = consolidado (sem duplicar).
 * Ignora o filtro de perfil (a tabela existe justamente para comparar), mas respeita os demais.
 */
export function profileComparison(input: ReportInput, filters: ReportFilters): ProfileRow[] {
  const rowFor = (profile: FinancialProfile | null): ProfileRow => {
    const r = buildOverviewLite(input, { ...filters, profileId: profile ? profile.id : ALL });
    return { profileId: profile?.id ?? ALL, name: profile?.name ?? "Consolidado", color: profile?.color, ...r };
  };
  return [...input.data.profiles.filter((p) => p.active).map(rowFor), rowFor(null)];
}

function buildOverviewLite(input: ReportInput, f: ReportFilters) {
  const { data, today } = input;
  const ctx: Ctx = {
    today,
    categories: new Map(data.categories.map((c) => [c.id, c])),
    cards: new Map(data.creditCards.map((c) => [c.id, c])),
    accounts: new Map(data.accounts.map((a) => [a.id, a])),
  };
  const all = data.transactions.filter((t) => matches(t, f, ctx));
  const realized = (t: Transaction) => bucketOf(t, today) === "realized";
  const cash = all.filter((t) => realized(t) && !isCardPurchase(t) && !INTERNAL_KINDS.includes(t.kind) && inPeriod(cashDateOf(t), f.period));
  return {
    receivedCents: sum(all.filter((t) => t.kind === "income" && realized(t) && inPeriod(t.date, f.period)).map((t) => t.amountCents)),
    consumptionCents: sum(all.filter((t) => (t.kind === "expense" || isCardPurchase(t)) && realized(t) && inPeriod(t.date, f.period)).map((t) => t.amountCents)),
    debtPaymentsCents: sum(all.filter((t) => t.kind === "debt_payment" && realized(t) && inPeriod(t.date, f.period)).map((t) => t.amountCents)),
    cashInCents: sum(cash.filter((t) => t.kind === "income").map((t) => t.amountCents)),
    cashOutCents: sum(cash.filter((t) => t.kind !== "income").map((t) => t.amountCents)),
  };
}

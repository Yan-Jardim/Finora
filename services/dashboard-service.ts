import {
  cardSummaryFrom,
  computeBalancesFrom,
  displayStatus,
  effectiveStatus,
  invoiceKey,
  monthBreakdown,
  rootCategory,
  sum,
  yearMonth,
} from "@/domain/calculations";
import { openDebtInstallments } from "@/domain/debts";
import { shiftYearMonth } from "@/domain/dates";
import {
  snapshotBalance,
  snapshotCardInvoices,
  snapshotReserved,
  snapshotInvoiceIndex,
  snapshotOf,
  snapshotUsedLimit,
} from "@/domain/snapshot";
import type {
  Account,
  Category,
  Cents,
  CreditCard,
  FinancialProfile,
  ISODate,
  Transaction,
  TransactionKind,
  TransactionStatus,
  WorkspaceData,
} from "@/domain/types";

/**
 * Serviço do dashboard: função PURA sobre os dados do workspace (os mesmos que os
 * cadastros leem/gravam via repositórios). Não há segunda fonte de dados.
 *
 * Origem dos números (veja domain/snapshot.ts):
 *  - saldos, faturas e limite usado: SNAPSHOT (views do banco no modo supabase; derivado no local);
 *  - receitas/despesas do mês, contas a pagar e recentes: as movimentações CARREGADAS (mês + pendências em aberto).
 *
 * Regras de visão:
 * - "Todos" = consolidado do workspace; cada conta/cartão/movimentação tem UM único dono,
 *   então nada é contado duas vezes.
 * - Perfil individual ou Casal = somente o que pertence a esse perfil.
 *   (Divisão de despesas do casal entre as pessoas fica para a fase de Casal.)
 */

export const ALL_PROFILES = "all";

/** Pagamentos de dívida sem categoria agrupam aqui (o gráfico precisa bater com "Despesas realizadas"). */
const DEBTS_BUCKET = "debts";

export interface DashboardFilters {
  /** "all" ou o id de um perfil. */
  profileId: string;
  /** "YYYY-MM" */
  month: string;
}

export interface CategorySpending {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  amountCents: Cents;
  percent: number;
}

export interface UpcomingItem {
  id: string;
  title: string;
  subtitle: string;
  date: ISODate;
  amountCents: Cents;
  type: "bill" | "invoice" | "debt";
  overdue: boolean;
}

export interface CardOverview {
  id: string;
  name: string;
  color: string;
  last4?: string;
  limitCents: Cents;
  usedCents: Cents;
  availableCents: Cents;
  usedPercent: number;
  invoiceCents: Cents;
  nextInvoiceCents: Cents;
  dueDay: number;
}

export interface RecentTransaction {
  id: string;
  description: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amountCents: Cents;
  date: ISODate;
  categoryName?: string;
  categoryColor?: string;
  categoryIcon?: string;
  contextLabel: string;
  profileName: string;
  profileColor: string;
  installmentLabel?: string;
}

export interface DashboardData {
  userName: string;
  month: string;
  today: ISODate;
  profiles: FinancialProfile[];
  filters: DashboardFilters;
  summary: {
    balanceCents: Cents;
    incomeCents: Cents;
    incomePendingCents: Cents;
    spentCents: Cents;
    plannedCents: Cents;
    plannedPendingCents: Cents;
    plannedFutureCents: Cents;
    invoicesCents: Cents;
    investmentsCents: Cents;
    netWorthCents: Cents;
    projectedBalanceCents: Cents;
    availableCents: Cents;
  };
  availableBreakdown: {
    balanceCents: Cents;
    remainingBillsCents: Cents;
    invoicesCents: Cents;
    debtsCents: Cents;
    reservedCents: Cents;
    availableCents: Cents;
  };
  spendingByCategory: CategorySpending[];
  upcoming: UpcomingItem[];
  cards: CardOverview[];
  recent: RecentTransaction[];
}

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((item) => [item.id, item]));

export function buildDashboard(
  data: WorkspaceData,
  filters: DashboardFilters,
  userName: string,
  today: ISODate,
): DashboardData {
  const { accounts, categories, creditCards, profiles, transactions } = data;
  const { month } = filters;
  // Perfil desconhecido (ex.: URL antiga) cai em "Todos".
  const profileId = profiles.some((p) => p.id === filters.profileId) ? filters.profileId : ALL_PROFILES;
  const scoped = profileId !== ALL_PROFILES;

  const txs = scoped ? transactions.filter((t) => t.profileId === profileId) : transactions;
  const visibleAccounts: Account[] = scoped ? accounts.filter((a) => a.ownerProfileId === profileId) : accounts;
  const visibleCards: CreditCard[] = (
    scoped ? creditCards.filter((c) => c.ownerProfileId === profileId) : creditCards
  ).filter((c) => c.active);

  const categoryMap = byId<Category>(categories);
  const profileMap = byId(profiles);
  const accountMap = byId(accounts);
  const cardMap = byId(creditCards);
  const snapshot = snapshotOf(data, today);
  const invoices = snapshotInvoiceIndex(snapshot);

  // ----- Resumo -----
  // Saldo em contas (sem investimentos), Investimentos e Patrimônio financeiro (= soma dos dois).
  // Saldo é fato da conta: usa TODAS as movimentações, independente de quem as registrou.
  const { accountsCents: balanceCents, investmentsCents, netWorthCents } = computeBalancesFrom(visibleAccounts, (a) => snapshotBalance(snapshot, a));

  // Receitas e despesas do mês vêm de UMA função compartilhada com a tela de Movimentações.
  const monthTotals = monthBreakdown(txs, month, today);
  const incomeCents = monthTotals.incomeReceivedCents;
  const incomePendingCents = monthTotals.incomeOpenCents;
  const spentCents = monthTotals.realizedCents;
  const plannedPendingCents = monthTotals.pendingCents;
  const plannedFutureCents = monthTotals.plannedCents;
  const plannedCents = plannedPendingCents + plannedFutureCents;

  // ----- Disponível de verdade (visão de caixa) -----
  // Uma compra no cartão é descontada UMA vez só: como parte da fatura (aberta). Ela não reduz
  // o saldo (a conta só diminui quando a fatura é paga) e não entra em "contas restantes".
  // Pagar a fatura reduz saldo e fatura na mesma medida -> o disponível não muda (sem dupla contagem).
  // Entram contas/faturas vencidas de meses anteriores (ainda não pagas) e as do mês; previstas só do mês.
  const invoicesCents = sum(
    visibleCards.flatMap((c) =>
      snapshotCardInvoices(snapshot, c.id)
        .filter((i) => i.dueMonth <= month)
        .map((i) => i.openCents),
    ),
  );
  const openBills = txs.filter((t) => {
    if (t.kind !== "expense" && t.kind !== "debt_payment") return false;
    const status = effectiveStatus(t, today);
    if (status === "planned") return yearMonth(t.date) === month;
    return (status === "pending" || status === "overdue") && yearMonth(t.date) <= month;
  });
  const remainingBillsCents = sum(openBills.filter((t) => t.kind === "expense").map((t) => t.amountCents));
  // Dívidas: parcelas EM ABERTO (derivadas) de dívidas ativas com vencimento até o mês + eventuais contas de dívida soltas
  // (debt_payment pendente sem vínculo, legado). Pagamento de parcela é transação paga: reduz o saldo E a parcela em
  // aberto na mesma medida, então o disponível não muda (sem dupla contagem).
  const scopedDebtIds = new Set(data.debts.filter((d) => !scoped || d.profileId === profileId).map((d) => d.id));
  const openDebtItems = openDebtInstallments(snapshot.debts, snapshot.debtInstallments, month, scopedDebtIds);
  const debtsCents =
    sum(openBills.filter((t) => t.kind === "debt_payment").map((t) => t.amountCents)) +
    sum(openDebtItems.map((i) => i.openCents));
  // Reservado em cofrinhos nas contas visíveis (derivado do histórico: v_account_reserves / soma dos movimentos).
  const reservedCents = sum(visibleAccounts.map((a) => snapshotReserved(snapshot, a.id)));
  const availableCents = balanceCents - remainingBillsCents - invoicesCents - debtsCents - reservedCents;

  const projectedBalanceCents = balanceCents + incomePendingCents - remainingBillsCents - invoicesCents - debtsCents;

  // ----- Gastos REALIZADOS por categoria -----
  // Mesmo conjunto do card "Despesas" (monthBreakdown.realizedExpenses): a soma bate exatamente.
  // Subcategorias são agrupadas na categoria principal.
  const totalsByCategory = new Map<string, Cents>();
  for (const t of monthTotals.realizedExpenses) {
    const key = rootCategory(t.categoryId, categoryMap)?.id ?? (t.kind === "debt_payment" ? DEBTS_BUCKET : "none");
    totalsByCategory.set(key, (totalsByCategory.get(key) ?? 0) + t.amountCents);
  }
  const spendingByCategory: CategorySpending[] = [...totalsByCategory.entries()]
    .map(([categoryId, amountCents]) => {
      const category = categoryMap.get(categoryId);
      return {
        categoryId,
        name: category?.name ?? (categoryId === DEBTS_BUCKET ? "Dívidas" : "Sem categoria"),
        icon: category?.icon ?? (categoryId === DEBTS_BUCKET ? "landmark" : "more"),
        color: category?.color ?? "#71717a",
        amountCents,
        percent: spentCents ? (amountCents / spentCents) * 100 : 0,
      };
    })
    .sort((x, y) => y.amountCents - x.amountCents);

  // ----- Próximas contas -----
  const upcoming: UpcomingItem[] = [];
  for (const t of openBills) {
    upcoming.push({
      id: t.id,
      title: t.description,
      subtitle: categoryMap.get(t.categoryId ?? "")?.name ?? "Sem categoria",
      date: t.dueDate ?? t.date,
      amountCents: t.amountCents,
      type: t.kind === "debt_payment" ? "debt" : "bill",
      overdue: effectiveStatus(t, today) === "overdue",
    });
  }
  const debtById = byId(data.debts);
  for (const i of openDebtItems) {
    const debt = debtById.get(i.debtId);
    const total = snapshot.debts.find((s) => s.debtId === i.debtId)?.installmentsCount;
    upcoming.push({
      id: `debt-${i.debtId}-${i.number}`,
      title: `${debt?.name ?? "Dívida"} — parcela ${i.number}${total ? `/${total}` : ""}`,
      subtitle: "Dívida",
      date: i.dueDate,
      amountCents: i.openCents,
      type: "debt",
      overdue: i.overdue,
    });
  }
  for (const card of visibleCards) {
    for (const invoice of snapshotCardInvoices(snapshot, card.id)) {
      if (invoice.dueMonth > month || invoice.openCents <= 0) continue;
      upcoming.push({
        id: `invoice-${card.id}-${invoice.dueMonth}`,
        title: `Fatura ${card.name}`,
        subtitle: "Cartão de crédito",
        date: invoice.dueDate,
        amountCents: invoice.openCents,
        type: "invoice",
        overdue: invoice.dueDate < today,
      });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  // ----- Cartões -----
  const cards: CardOverview[] = visibleCards.map((card) => {
    const summary = cardSummaryFrom(card, snapshotCardInvoices(snapshot, card.id), snapshotUsedLimit(snapshot, card), today);
    return {
      id: card.id,
      name: card.name,
      color: card.color,
      last4: card.last4,
      limitCents: card.limitCents,
      usedCents: summary.usedCents,
      availableCents: summary.availableCents,
      usedPercent: (summary.usedCents / card.limitCents) * 100,
      invoiceCents: invoices.get(invoiceKey(card.id, month))?.openCents ?? 0,
      nextInvoiceCents: invoices.get(invoiceKey(card.id, shiftYearMonth(month, 1)))?.openCents ?? 0,
      dueDay: card.dueDay,
    };
  });

  // ----- Últimas movimentações -----
  const place = (t: Transaction) => {
    const from = accountMap.get(t.accountId ?? "")?.name;
    if (t.kind === "transfer") return `${from ?? "—"} → ${accountMap.get(t.toAccountId ?? "")?.name ?? "—"}`;
    if (t.kind === "card_payment") return `${from ?? "—"} → ${cardMap.get(t.cardId ?? "")?.name ?? "—"}`;
    return (t.cardId ? cardMap.get(t.cardId)?.name : from) ?? "—";
  };
  const recent: RecentTransaction[] = txs
    .filter((t) => t.date <= today && t.status !== "planned" && t.status !== "canceled")
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 7)
    .map((t) => {
      const category = categoryMap.get(t.categoryId ?? "");
      const profile = profileMap.get(t.profileId);
      return {
        id: t.id,
        description: t.description,
        kind: t.kind,
        status: displayStatus(t, today, cardMap, invoices),
        amountCents: t.amountCents,
        date: t.date,
        categoryName: category?.name,
        categoryColor: category?.color,
        categoryIcon: category?.icon,
        contextLabel: place(t),
        profileName: profile?.name ?? "—",
        profileColor: profile?.color ?? "#71717a",
        installmentLabel: t.installment ? `${t.installment.number}/${t.installment.total}` : undefined,
      };
    });

  return {
    userName,
    month,
    today,
    profiles: profiles.filter((p) => p.active),
    filters: { profileId, month },
    summary: {
      balanceCents,
      incomeCents,
      incomePendingCents,
      spentCents,
      plannedCents,
      plannedPendingCents,
      plannedFutureCents,
      invoicesCents,
      investmentsCents,
      netWorthCents,
      projectedBalanceCents,
      availableCents,
    },
    availableBreakdown: { balanceCents, remainingBillsCents, invoicesCents, debtsCents, reservedCents, availableCents },
    spendingByCategory,
    upcoming,
    cards,
    recent,
  };
}

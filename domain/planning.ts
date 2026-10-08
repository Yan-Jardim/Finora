import { invoiceCycle, purchaseInvoiceMonth, sum } from "./calculations";
import { addMonths, shiftYearMonth, yearMonth } from "./dates";
import { splitCents } from "./installments";
import { snapshotBalance, snapshotOf, snapshotReserved, snapshotUsedLimit } from "./snapshot";
import type { Cents, CreditCard, ID, ISODate, WorkspaceData } from "./types";

/**
 * PLANEJAMENTO FINANCEIRO — projeção de FLUXO DE CAIXA, derivada dos dados existentes (nada é gravado).
 *
 * Fórmula (por mês M):
 *   saldo inicial(M)  = saldo final(M-1)           (o 1º mês começa no saldo ATUAL das contas, sem investimentos)
 *   entradas(M)       = receitas em aberto (previstas/pendentes) que caem em M
 *   saídas(M)         = contas/despesas em aberto + faturas de cartão em aberto + parcelas de dívida em aberto
 *                       + saídas de transferências para fora do "saldo em contas"
 *   saldo final(M)    = saldo inicial(M) + entradas(M) − saídas(M)
 *
 * Sem dupla contagem (cada obrigação entra UMA vez, por uma única porta):
 *  - compra no cartão (à vista, parcelada ou recorrente) NUNCA entra como saída pela data da compra: o dinheiro só sai
 *    quando a FATURA é paga, então entra pelo valor EM ABERTO da fatura (que já contém essas compras);
 *  - o que já foi pago (pagamento de fatura, de dívida, despesa paga) já está no saldo atual: não é projetado de novo;
 *  - a dívida (contrato) nunca soma; entram só as PARCELAS em aberto (derivadas) de dívidas ativas;
 *  - recorrências entram pelas OCORRÊNCIAS já materializadas (transações) — nada é inventado além do horizonte (12 meses);
 *  - atrasados (vencimento antes de hoje, ainda em aberto) caem no mês atual, marcados como atrasados;
 *  - valores previstos nunca são tratados como saldo de hoje (o saldo inicial é o saldo real).
 */

export const PLANNING_MAX_MONTHS = 12;
export const ALL_PROFILES_FILTER = "all";

export type PlanningItemType = "income" | "bill" | "invoice" | "debt" | "transfer" | "simulation";

export interface PlanningItemPart {
  title: string;
  date: ISODate;
  amountCents: Cents;
  label?: string;
}

export interface PlanningItem {
  id: string;
  type: PlanningItemType;
  direction: "in" | "out";
  title: string;
  subtitle: string;
  /** Data em que o dinheiro entra/sai (vencimento; atrasados caem em hoje). */
  date: ISODate;
  /** Vencimento original. */
  dueDate: ISODate;
  /** Sempre positivo; o sinal vem de `direction`. */
  amountCents: Cents;
  overdue: boolean;
  /** Veio de uma recorrência. */
  recurring: boolean;
  transactionId?: ID;
  cardId?: ID;
  debtId?: ID;
  /** Fatura: compras que a compõem (as carregadas) e o que falta reconciliar. */
  parts?: PlanningItemPart[];
  unlistedCents?: Cents;
  invoiceTotalCents?: Cents;
  invoicePaidCents?: Cents;
}

export interface PlanningBuckets {
  incomeRecurringCents: Cents;
  incomeOtherCents: Cents;
  billsCents: Cents;
  recurringBillsCents: Cents;
  invoicesCents: Cents;
  debtsCents: Cents;
  transfersOutCents: Cents;
  transfersInCents: Cents;
  simulationCents: Cents;
}

export interface PlanningMonth {
  month: string;
  startBalanceCents: Cents;
  incomeCents: Cents;
  outflowCents: Cents;
  netCents: Cents;
  endBalanceCents: Cents;
  buckets: PlanningBuckets;
  items: PlanningItem[];
}

export type PlanningAlertKind = "overdue" | "negative_balance" | "deficit" | "invoices_next_month";

export interface PlanningAlert {
  id: string;
  kind: PlanningAlertKind;
  severity: "danger" | "warning" | "info";
  month?: string;
  /** Valor relevante (déficit, fatura, saldo negativo, total em atraso). */
  cents?: Cents;
  /** Quantidade (contas atrasadas). */
  count?: number;
}

export interface Planning {
  today: ISODate;
  profileId: string;
  monthsCount: number;
  startBalanceCents: Cents;
  /**
   * INFORMAÇÃO (não entra na projeção): dinheiro reservado em cofrinhos hoje nas contas consideradas. A projeção continua
   * partindo do saldo REAL; o reservado só mostra quanto dele já tem destino.
   */
  reservedCents: Cents;
  months: PlanningMonth[];
  endBalanceCents: Cents;
  totalIncomeCents: Cents;
  totalOutflowCents: Cents;
  /** Menor saldo final projetado no período. */
  lowest: { month: string; balanceCents: Cents } | null;
  /** Contas/faturas/parcelas de dívida atrasadas (saídas). */
  overdue: { count: number; cents: Cents };
  alerts: PlanningAlert[];
}

export interface PurchaseSimulation {
  description: string;
  totalCents: Cents;
  installments: number;
  date: ISODate;
  method: "card" | "cash";
  cardId?: ID;
}

export interface PlanningFilters {
  /** "all" ou o id de um perfil (pessoa ou Casal). */
  profileId: string;
  /** 1 a 12 meses a partir do mês atual. */
  months: number;
}

const OPEN_STATUSES = new Set(["planned", "pending"]);

/** Itens em aberto de uma simulação de compra (nunca são gravados). */
export function simulationItems(sim: PurchaseSimulation, cards: CreditCard[], today: ISODate): PlanningItem[] {
  const date = sim.date < today ? today : sim.date;
  const card = sim.method === "card" ? cards.find((c) => c.id === sim.cardId) : undefined;
  const title = sim.description.trim() || "Compra simulada";

  if (sim.method === "card" && card) {
    return splitCents(sim.totalCents, Math.max(1, sim.installments)).map((amountCents, index, all) => {
      const purchaseDate = addMonths(date, index);
      // A compra cai na fatura do ciclo dela: o dinheiro sai no vencimento dessa fatura.
      const due = invoiceCycle(card, purchaseDate).dueDate;
      return {
        id: `sim-${index + 1}`,
        type: "simulation" as const,
        direction: "out" as const,
        title: `${title}${all.length > 1 ? ` — ${index + 1}/${all.length}` : ""}`,
        subtitle: `Simulação · fatura ${card.name}`,
        date: due,
        dueDate: due,
        amountCents,
        overdue: false,
        recurring: false,
      };
    });
  }
  return [
    {
      id: "sim-1",
      type: "simulation",
      direction: "out",
      title,
      subtitle: "Simulação · à vista",
      date,
      dueDate: date,
      amountCents: sim.totalCents,
      overdue: false,
      recurring: false,
    },
  ];
}

const emptyBuckets = (): PlanningBuckets => ({
  incomeRecurringCents: 0,
  incomeOtherCents: 0,
  billsCents: 0,
  recurringBillsCents: 0,
  invoicesCents: 0,
  debtsCents: 0,
  transfersOutCents: 0,
  transfersInCents: 0,
  simulationCents: 0,
});

/**
 * Monta a projeção a partir dos dados do workspace (cadastros + movimentações EM ABERTO carregadas + snapshot).
 * No Supabase as movimentações vêm só do que a tela pede (itens em aberto até o fim do horizonte; compras no cartão
 * recentes para detalhar faturas) — o saldo, as faturas e as parcelas de dívida vêm das views (snapshot).
 */
export function buildPlanning(
  data: WorkspaceData,
  filters: PlanningFilters,
  today: ISODate,
  simulation?: PurchaseSimulation,
): Planning {
  const profileId = data.profiles.some((p) => p.id === filters.profileId) ? filters.profileId : ALL_PROFILES_FILTER;
  const scoped = profileId !== ALL_PROFILES_FILTER;
  const monthsCount = Math.max(1, Math.min(PLANNING_MAX_MONTHS, Math.floor(filters.months) || PLANNING_MAX_MONTHS));
  const first = yearMonth(today);
  const last = shiftYearMonth(first, monthsCount - 1);
  const snapshot = snapshotOf(data, today);

  const accounts = scoped ? data.accounts.filter((a) => a.ownerProfileId === profileId) : data.accounts;
  const spendable = new Set(accounts.filter((a) => a.active && a.includeInNetWorth && a.type !== "investment").map((a) => a.id));
  const startBalanceCents = sum(accounts.filter((a) => spendable.has(a.id)).map((a) => snapshotBalance(snapshot, a)));
  const reservedCents = sum(accounts.filter((a) => spendable.has(a.id)).map((a) => snapshotReserved(snapshot, a.id)));

  const cards = scoped ? data.creditCards.filter((c) => c.ownerProfileId === profileId) : data.creditCards;
  const cardById = new Map(data.creditCards.map((c) => [c.id, c]));
  const items: PlanningItem[] = [];

  /** Atrasado (vencimento antes de hoje) cai em hoje; fora do horizonte é ignorado. */
  const place = (due: ISODate): { date: ISODate; month: string; overdue: boolean } | null => {
    const overdue = due < today;
    const date = overdue ? today : due;
    const month = yearMonth(date);
    return month > last ? null : { date, month, overdue };
  };

  // 1) Movimentações em aberto (receitas, contas, despesas, recorrências materializadas, transferências).
  //    Compra no cartão NÃO entra aqui (entra pela fatura); pagamento de fatura é sempre pago.
  for (const tx of data.transactions) {
    if (!OPEN_STATUSES.has(tx.status)) continue;
    if (tx.kind === "credit_card_purchase" || tx.kind === "card_payment") continue;
    if (scoped && tx.profileId !== profileId) continue;
    const due = tx.dueDate ?? tx.date;
    const where = place(due);
    if (!where) continue;

    let direction: "in" | "out";
    let amountCents = tx.amountCents;
    let type: PlanningItemType;
    if (tx.kind === "income") {
      direction = "in";
      type = "income";
    } else if (tx.kind === "expense" || tx.kind === "debt_payment") {
      direction = "out";
      type = "bill";
    } else {
      // transferência/investimento/resgate: só o que entra/sai do "saldo em contas" visível
      const delta = (tx.toAccountId && spendable.has(tx.toAccountId) ? tx.amountCents : 0) - (tx.accountId && spendable.has(tx.accountId) ? tx.amountCents : 0);
      if (delta === 0) continue;
      direction = delta > 0 ? "in" : "out";
      amountCents = Math.abs(delta);
      type = "transfer";
    }
    items.push({
      id: `tx-${tx.id}`,
      type,
      direction,
      title: tx.description,
      subtitle: tx.recurringId ? "Recorrente" : type === "income" ? "Receita" : type === "transfer" ? "Transferência" : "Conta a pagar",
      date: where.date,
      dueDate: due,
      amountCents,
      overdue: where.overdue,
      recurring: !!tx.recurringId,
      transactionId: tx.id,
    });
  }

  // 2) Faturas de cartão: o valor EM ABERTO (compras - pagamentos) sai no vencimento da fatura.
  const cardIds = new Set(cards.map((c) => c.id));
  for (const invoice of snapshot.invoices) {
    if (invoice.openCents <= 0 || !cardIds.has(invoice.cardId)) continue;
    const where = place(invoice.dueDate);
    if (!where) continue;
    const card = cardById.get(invoice.cardId)!;
    const parts = data.transactions
      .filter((t) => t.kind === "credit_card_purchase" && t.cardId === card.id && t.status !== "canceled" && purchaseInvoiceMonth(card, t) === invoice.dueMonth)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map<PlanningItemPart>((t) => ({
        title: t.description,
        date: t.date,
        amountCents: t.amountCents,
        label: t.installment ? `${t.installment.number}/${t.installment.total}` : t.recurringId ? "recorrente" : undefined,
      }));
    items.push({
      id: `inv-${invoice.cardId}-${invoice.dueMonth}`,
      type: "invoice",
      direction: "out",
      title: `Fatura ${card.name}`,
      subtitle: "Cartão de crédito",
      date: where.date,
      dueDate: invoice.dueDate,
      amountCents: invoice.openCents,
      overdue: where.overdue,
      recurring: false,
      cardId: card.id,
      parts,
      unlistedCents: Math.max(0, invoice.totalCents - sum(parts.map((p) => p.amountCents))),
      invoiceTotalCents: invoice.totalCents,
      invoicePaidCents: invoice.paidCents,
    });
  }

  // 3) Parcelas de dívida em aberto (derivadas) de dívidas ATIVAS. O contrato nunca soma; pagas já estão no saldo.
  const activeDebts = new Set(snapshot.debts.filter((d) => d.status === "active").map((d) => d.debtId));
  const debtById = new Map(data.debts.map((d) => [d.id, d]));
  for (const inst of snapshot.debtInstallments) {
    const debt = debtById.get(inst.debtId);
    if (!debt || inst.openCents <= 0 || !activeDebts.has(inst.debtId)) continue;
    if (scoped && debt.profileId !== profileId) continue;
    const where = place(inst.dueDate);
    if (!where) continue;
    items.push({
      id: `debt-${inst.debtId}-${inst.number}`,
      type: "debt",
      direction: "out",
      title: `${debt.name} — parcela ${inst.number}/${debt.installments ?? inst.number}`,
      subtitle: "Dívida",
      date: where.date,
      dueDate: inst.dueDate,
      amountCents: inst.openCents,
      overdue: where.overdue,
      recurring: false,
      debtId: debt.id,
    });
  }

  // 4) Simulação (overlay; nunca é gravada).
  if (simulation && simulation.totalCents > 0) {
    for (const item of simulationItems(simulation, data.creditCards, today)) {
      const where = place(item.date);
      if (where) items.push({ ...item, date: where.date });
    }
  }

  // Agregação mensal + saldo corrido.
  const months: PlanningMonth[] = [];
  let balance = startBalanceCents;
  for (let i = 0; i < monthsCount; i++) {
    const month = shiftYearMonth(first, i);
    const list = items.filter((it) => yearMonth(it.date) === month).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "pt-BR"));
    const b = emptyBuckets();
    for (const it of list) {
      const v = it.amountCents;
      if (it.type === "income") {
        if (it.recurring) b.incomeRecurringCents += v;
        else b.incomeOtherCents += v;
      } else if (it.type === "bill") {
        if (it.recurring) b.recurringBillsCents += v;
        else b.billsCents += v;
      } else if (it.type === "invoice") b.invoicesCents += v;
      else if (it.type === "debt") b.debtsCents += v;
      else if (it.type === "simulation") b.simulationCents += v;
      else if (it.direction === "in") b.transfersInCents += v;
      else b.transfersOutCents += v;
    }
    const incomeCents = sum(list.filter((it) => it.direction === "in").map((it) => it.amountCents));
    const outflowCents = sum(list.filter((it) => it.direction === "out").map((it) => it.amountCents));
    const start = balance;
    balance = start + incomeCents - outflowCents;
    months.push({ month, startBalanceCents: start, incomeCents, outflowCents, netCents: incomeCents - outflowCents, endBalanceCents: balance, buckets: b, items: list });
  }

  const overdueItems = items.filter((it) => it.overdue && it.direction === "out" && it.type !== "transfer");
  const lowest = months.reduce<Planning["lowest"]>((low, m) => (!low || m.endBalanceCents < low.balanceCents ? { month: m.month, balanceCents: m.endBalanceCents } : low), null);

  const planning: Planning = {
    today,
    profileId,
    monthsCount,
    startBalanceCents,
    reservedCents,
    months,
    endBalanceCents: months.at(-1)?.endBalanceCents ?? startBalanceCents,
    totalIncomeCents: sum(months.map((m) => m.incomeCents)),
    totalOutflowCents: sum(months.map((m) => m.outflowCents)),
    lowest,
    overdue: { count: overdueItems.length, cents: sum(overdueItems.map((it) => it.amountCents)) },
    alerts: [],
  };
  planning.alerts = planningAlerts(planning);
  return planning;
}

/** Alertas DERIVADOS da projeção (nenhum texto fixo): atrasos, saldo negativo, déficits e faturas do próximo mês. */
export function planningAlerts(p: Planning): PlanningAlert[] {
  const alerts: PlanningAlert[] = [];
  if (p.overdue.count > 0) {
    alerts.push({ id: "overdue", kind: "overdue", severity: "danger", count: p.overdue.count, cents: p.overdue.cents, month: p.months[0]?.month });
  }
  const negative = p.months.find((m) => m.endBalanceCents < 0);
  if (negative) {
    alerts.push({ id: `negative-${negative.month}`, kind: "negative_balance", severity: "danger", month: negative.month, cents: negative.endBalanceCents });
  }
  p.months
    .filter((m) => m.outflowCents > m.incomeCents)
    .slice(0, 2)
    .forEach((m) => alerts.push({ id: `deficit-${m.month}`, kind: "deficit", severity: "warning", month: m.month, cents: m.outflowCents - m.incomeCents }));
  const next = p.months[1];
  if (next && next.buckets.invoicesCents > 0) {
    alerts.push({ id: `invoices-${next.month}`, kind: "invoices_next_month", severity: "info", month: next.month, cents: next.buckets.invoicesCents });
  }
  return alerts;
}

export interface SimulationComparison {
  /** Projeção sem a compra. */
  base: Planning;
  /** Projeção com a compra. */
  withPurchase: Planning;
  months: { month: string; impactCents: Cents; baseEndCents: Cents; simEndCents: Cents }[];
  /** Meses em que o saldo final fica negativo COM a compra e não ficava antes. */
  newNegativeMonths: string[];
  /** A compra no cartão cabe no limite disponível? (null = à vista) */
  fitsCardLimit: boolean | null;
  cardAvailableCents: Cents | null;
}

/** Compara a projeção com e sem a compra simulada. Pura: não grava nada. */
export function compareSimulation(
  data: WorkspaceData,
  filters: PlanningFilters,
  today: ISODate,
  simulation: PurchaseSimulation,
): SimulationComparison {
  const base = buildPlanning(data, filters, today);
  const withPurchase = buildPlanning(data, filters, today, simulation);
  const snapshot = snapshotOf(data, today);
  const card = simulation.method === "card" ? data.creditCards.find((c) => c.id === simulation.cardId) : undefined;
  const available = card ? card.limitCents - snapshotUsedLimit(snapshot, card) : null;
  return {
    base,
    withPurchase,
    months: withPurchase.months.map((m, i) => ({
      month: m.month,
      impactCents: m.buckets.simulationCents,
      baseEndCents: base.months[i].endBalanceCents,
      simEndCents: m.endBalanceCents,
    })),
    newNegativeMonths: withPurchase.months.filter((m, i) => m.endBalanceCents < 0 && base.months[i].endBalanceCents >= 0).map((m) => m.month),
    fitsCardLimit: available === null ? null : simulation.totalCents <= available,
    cardAvailableCents: available,
  };
}


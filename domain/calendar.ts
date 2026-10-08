import { displayStatus, isExpenseLike, isRealizedExpense, sum } from "./calculations";
import { dateWithDay, daysInMonth, monthEnd, monthStart, shiftYearMonth, yearMonth } from "./dates";
import { buildPlanning, PLANNING_MAX_MONTHS } from "./planning";
import { snapshotInvoiceIndex, snapshotOf } from "./snapshot";
import type { Cents, ID, ISODate, WorkspaceData } from "./types";

/**
 * CALENDÁRIO FINANCEIRO — visão por data dos compromissos, derivada dos dados existentes (nada é gravado).
 *
 * Cada obrigação entra por UMA única porta (as mesmas regras do Planejamento):
 *  - receitas, despesas, transferências, recorrências (ocorrências já materializadas), parcelamentos e pagamentos
 *    realizados vêm das MOVIMENTAÇÕES;
 *  - compra no cartão aparece na data da compra só como informação ("na fatura"): não é saída de caixa nem entra em
 *    "pendentes"; o dinheiro sai quando a FATURA é paga, então a fatura (valor em aberto) é o evento de caixa;
 *  - fatura paga NÃO vira evento: o que aparece é o pagamento (movimentação `card_payment`), que não é despesa;
 *  - dívida: só as PARCELAS em aberto (derivadas) de dívidas ativas; o que já foi pago aparece como pagamento realizado;
 *  - o que está pago não é descontado de novo: pendentes/previstos olham apenas o que ainda está em aberto;
 *  - atrasado mantém a DATA ORIGINAL (diferente do Planejamento, que o joga para hoje) e leva o marcador "atrasado".
 *
 * Datas são strings ISO e a noção de "hoje" é a do fuso da família (vem de fora): nada aqui usa o relógio do navegador.
 */

export type CalendarEventType =
  | "income"
  | "expense"
  | "transfer"
  | "card_purchase"
  | "card_payment"
  | "invoice"
  | "debt_installment"
  | "debt_payment";

/** "paid" = pago/recebido/realizado; "planned" = previsto (ainda não confirmado/fechado). */
export type CalendarStatus = "paid" | "pending" | "planned" | "overdue";

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  /** `neutral`: transferências e pagamentos de fatura (movem dinheiro entre contas/passivo, não são ganho nem gasto). */
  direction: "in" | "out" | "neutral";
  title: string;
  subtitle: string;
  /** Data em que aparece (vencimento; realizado = data da movimentação). Nunca é alterada por estar atrasado. */
  date: ISODate;
  /** Sempre positivo. Fatura/parcela: valor EM ABERTO. */
  amountCents: Cents;
  status: CalendarStatus;
  recurring: boolean;
  /** "2/10" (parcelamento no cartão/conta ou parcela de dívida). */
  installmentLabel?: string;
  /** Pagamento parcial: quanto já foi pago do total (fatura) ou da parcela. */
  paidCents?: Cents;
  /** Valor total (fatura/parcela) quando `amountCents` é só o que falta. */
  totalCents?: Cents;
  profileId: ID;
  accountId?: ID;
  toAccountId?: ID;
  cardId?: ID;
  categoryId?: ID;
  debtId?: ID;
  transactionId?: ID;
  /** Despesa realizada segundo o motor existente (`isRealizedExpense`). */
  realizedExpense: boolean;
  /** Tela existente onde o item é editado/pago (o calendário não cria regras de pagamento). */
  href: string;
}

export const CALENDAR_ALL = "all";

export type CalendarGroup = "all" | "income" | "expense" | "transfer" | "invoice" | "debt" | "recurring" | "installment";
export type CalendarStatusFilter = "all" | CalendarStatus;

export interface CalendarFilters {
  /** "all" ou id de perfil (pessoa/Casal). */
  profileId: string;
  accountId: string;
  cardId: string;
  categoryId: string;
  group: CalendarGroup;
  status: CalendarStatusFilter;
}

export const defaultCalendarFilters: CalendarFilters = {
  profileId: CALENDAR_ALL,
  accountId: CALENDAR_ALL,
  cardId: CALENDAR_ALL,
  categoryId: CALENDAR_ALL,
  group: "all",
  status: "all",
};

export const hasExtraFilters = (f: CalendarFilters) =>
  f.accountId !== CALENDAR_ALL || f.cardId !== CALENDAR_ALL || f.categoryId !== CALENDAR_ALL || f.group !== "all" || f.status !== "all";

export interface CalendarDay {
  date: ISODate;
  events: CalendarEvent[];
  /** Receitas do dia (recebidas + a receber). */
  inCents: Cents;
  /** Saídas de caixa do dia (contas, faturas, parcelas, pagamentos; sem compras no cartão). */
  outCents: Cents;
  /** Compras no cartão do dia (informativo). */
  cardCents: Cents;
  overdue: boolean;
  /** Tem algo em aberto (pendente/previsto/atrasado). */
  open: boolean;
}

export interface CalendarSummary {
  incomeReceivedCents: Cents;
  incomeOpenCents: Cents;
  realizedExpensesCents: Cents;
  /** Pendentes + atrasados (inclui atrasados de meses anteriores quando o mês é o atual ou futuro). */
  pendingCents: Cents;
  pendingCount: number;
  /** Previstos (ainda não confirmados) do mês. */
  plannedCents: Cents;
  /** Tudo o que ainda vai sair: pendentes + previstos. */
  totalForecastCents: Cents;
  invoicesDueCents: Cents;
  invoicesDueCount: number;
  overdueCents: Cents;
  overdueCount: number;
  /** Fim do mês segundo o Planejamento; null se o mês é passado, passa de 12 meses ou há filtros que ele não entende. */
  projectedBalanceCents: Cents | null;
}

export interface CalendarMonth {
  month: string;
  /** Eventos do mês, em ordem de data. */
  events: CalendarEvent[];
  /** Em aberto e atrasados de meses anteriores (só para mês atual/futuro). */
  carriedOverdue: CalendarEvent[];
  /** Por data (inclui dias fora do mês que a janela carregou, para a visão semanal). */
  days: Map<ISODate, CalendarDay>;
  summary: CalendarSummary;
  upcoming: CalendarEvent[];
}

const OPEN: ReadonlySet<CalendarStatus> = new Set(["pending", "planned", "overdue"]);
export const isOpenEvent = (e: CalendarEvent) => OPEN.has(e.status);
const isCashOut = (e: CalendarEvent) => e.direction === "out" && e.type !== "card_purchase";

/** Todos os eventos possíveis a partir do que está carregado (sem filtros). */
export function collectEvents(data: WorkspaceData, today: ISODate): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const snapshot = snapshotOf(data, today);
  const cardById = new Map(data.creditCards.map((c) => [c.id, c]));
  const invoiceIndex = snapshotInvoiceIndex(snapshot);

  // 1) Movimentações
  for (const tx of data.transactions) {
    if (tx.status === "canceled") continue;
    const status = displayStatus(tx, today, cardById, invoiceIndex);
    if (status === "canceled") continue;
    const open = status !== "paid";
    const date = open ? (tx.dueDate ?? tx.date) : tx.date;

    let type: CalendarEventType;
    let direction: CalendarEvent["direction"];
    let subtitle: string;
    switch (tx.kind) {
      case "income":
        type = "income";
        direction = "in";
        subtitle = "Receita";
        break;
      case "expense":
        type = "expense";
        direction = "out";
        subtitle = "Despesa";
        break;
      case "credit_card_purchase":
        type = "card_purchase";
        direction = "out";
        subtitle = "Compra no cartão (entra na fatura)";
        break;
      case "card_payment":
        type = "card_payment";
        direction = "neutral";
        subtitle = "Pagamento de fatura";
        break;
      case "debt_payment":
        type = "debt_payment";
        direction = "out";
        subtitle = "Pagamento de dívida";
        break;
      default:
        type = "transfer";
        direction = "neutral";
        subtitle = tx.kind === "investment" ? "Investimento" : tx.kind === "redemption" ? "Resgate" : "Transferência";
    }
    if (tx.recurringId) subtitle = `${subtitle} · recorrente`;

    events.push({
      id: `tx-${tx.id}`,
      type,
      direction,
      title: tx.description,
      subtitle,
      date,
      amountCents: tx.amountCents,
      status: status as CalendarStatus,
      recurring: !!tx.recurringId,
      installmentLabel: tx.installment ? `${tx.installment.number}/${tx.installment.total}` : undefined,
      profileId: tx.profileId,
      accountId: tx.accountId,
      toAccountId: tx.toAccountId,
      cardId: tx.cardId,
      categoryId: tx.categoryId,
      debtId: tx.debtId,
      transactionId: tx.id,
      realizedExpense: isExpenseLike(tx) && isRealizedExpense(tx, today),
      href: type === "debt_payment" ? "/dividas" : "/movimentacoes",
    });
  }

  // 2) Faturas em aberto (a paga aparece como o pagamento dela). Fatura ainda não fechada = prevista.
  for (const invoice of snapshot.invoices) {
    const card = cardById.get(invoice.cardId);
    if (!card || invoice.paid || invoice.openCents <= 0) continue;
    const status: CalendarStatus = invoice.dueDate < today ? "overdue" : invoice.closingDate > today ? "planned" : "pending";
    events.push({
      id: `inv-${invoice.cardId}-${invoice.dueMonth}`,
      type: "invoice",
      direction: "out",
      title: `Fatura ${card.name}`,
      subtitle: invoice.closingDate > today ? "Fatura aberta (ainda recebendo compras)" : "Fatura fechada",
      date: invoice.dueDate,
      amountCents: invoice.openCents,
      status,
      recurring: false,
      paidCents: invoice.paidCents > 0 ? invoice.paidCents : undefined,
      totalCents: invoice.paidCents > 0 ? invoice.totalCents : undefined,
      profileId: card.ownerProfileId,
      cardId: card.id,
      realizedExpense: false,
      href: "/cartoes",
    });
  }

  // 3) Parcelas em aberto de dívidas ativas (derivadas). Contrato nunca soma.
  const activeDebts = new Set(snapshot.debts.filter((d) => d.status === "active").map((d) => d.debtId));
  const debtById = new Map(data.debts.map((d) => [d.id, d]));
  for (const inst of snapshot.debtInstallments) {
    const debt = debtById.get(inst.debtId);
    if (!debt || inst.openCents <= 0 || !activeDebts.has(inst.debtId)) continue;
    events.push({
      id: `debt-${inst.debtId}-${inst.number}`,
      type: "debt_installment",
      direction: "out",
      title: `${debt.name} — parcela ${inst.number}/${debt.installments ?? inst.number}`,
      subtitle: "Parcela de dívida",
      date: inst.dueDate,
      amountCents: inst.openCents,
      status: inst.overdue ? "overdue" : "pending",
      recurring: false,
      installmentLabel: `${inst.number}/${debt.installments ?? inst.number}`,
      paidCents: inst.paidCents > 0 ? inst.paidCents : undefined,
      totalCents: inst.paidCents > 0 ? inst.amountCents : undefined,
      profileId: debt.profileId,
      categoryId: debt.categoryId,
      debtId: debt.id,
      realizedExpense: false,
      href: "/dividas",
    });
  }
  return events;
}

const GROUPS: Record<Exclude<CalendarGroup, "all">, (e: CalendarEvent) => boolean> = {
  income: (e) => e.type === "income",
  expense: (e) => e.type === "expense" || e.type === "card_purchase" || e.type === "debt_payment",
  transfer: (e) => e.type === "transfer",
  invoice: (e) => e.type === "invoice" || e.type === "card_payment",
  debt: (e) => e.type === "debt_installment" || e.type === "debt_payment",
  recurring: (e) => e.recurring,
  installment: (e) => !!e.installmentLabel && e.type !== "debt_installment",
};

/**
 * Filtros combinados (E). Cada evento tem UM dono (`profileId`), então "Todos" é a soma das partes e uma despesa do
 * Casal nunca é contada duas vezes. Itens sem conta (fatura, parcela de dívida, compra no cartão) saem quando se
 * filtra por conta; itens sem cartão/categoria saem quando se filtra por cartão/categoria.
 */
export function filterEvents(events: CalendarEvent[], f: CalendarFilters): CalendarEvent[] {
  return events.filter((e) => {
    if (f.profileId !== CALENDAR_ALL && e.profileId !== f.profileId) return false;
    if (f.accountId !== CALENDAR_ALL && e.accountId !== f.accountId && e.toAccountId !== f.accountId) return false;
    if (f.cardId !== CALENDAR_ALL && e.cardId !== f.cardId) return false;
    if (f.categoryId !== CALENDAR_ALL && e.categoryId !== f.categoryId) return false;
    if (f.group !== "all" && !GROUPS[f.group](e)) return false;
    if (f.status !== "all" && e.status !== f.status) return false;
    return true;
  });
}

const byDate = (a: CalendarEvent, b: CalendarEvent) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "pt-BR");

function dayOf(date: ISODate, events: CalendarEvent[]): CalendarDay {
  return {
    date,
    events,
    inCents: sum(events.filter((e) => e.direction === "in").map((e) => e.amountCents)),
    outCents: sum(events.filter(isCashOut).map((e) => e.amountCents)),
    cardCents: sum(events.filter((e) => e.type === "card_purchase").map((e) => e.amountCents)),
    overdue: events.some((e) => e.status === "overdue"),
    open: events.some((e) => isOpenEvent(e) && e.type !== "card_purchase"),
  };
}

/** Meses entre `from` e `to` ("YYYY-MM"). */
const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

export const UPCOMING_LIMIT = 8;

/**
 * Até onde o calendário enxerga em aberto: o fim do mês visto ou do PRÓXIMO mês (o que for mais distante). É também o
 * horizonte da consulta ao banco (`calendarWindow`), então "Próximos vencimentos" é igual nos dois modos.
 */
export function calendarHorizon(month: string, today: ISODate): ISODate {
  const next = shiftYearMonth(yearMonth(today), 1);
  return monthEnd(month > next ? month : next);
}

/** Próximos vencimentos: atrasados primeiro (data original), depois o que vem aí. Sem compras no cartão. */
export function upcomingEvents(events: CalendarEvent[], today: ISODate, limit = UPCOMING_LIMIT): CalendarEvent[] {
  const open = events.filter((e) => isOpenEvent(e) && e.type !== "card_purchase" && e.direction !== "neutral");
  const overdue = open.filter((e) => e.status === "overdue" || e.date < today).sort(byDate);
  const ahead = open.filter((e) => e.status !== "overdue" && e.date >= today).sort(byDate);
  return [...overdue, ...ahead].slice(0, limit);
}

export function buildCalendar(data: WorkspaceData, month: string, filters: CalendarFilters, today: ISODate): CalendarMonth {
  const profileId = filters.profileId === CALENDAR_ALL || data.profiles.some((p) => p.id === filters.profileId) ? filters.profileId : CALENDAR_ALL;
  const f = { ...filters, profileId };
  const all = filterEvents(collectEvents(data, today), f);
  const start = monthStart(month);
  const end = monthEnd(month);
  const currentMonth = yearMonth(today);

  const events = all.filter((e) => e.date >= start && e.date <= end).sort(byDate);
  // Atrasados de meses anteriores só fazem sentido (e só foram carregados) do mês atual em diante.
  const carriedOverdue =
    month >= currentMonth ? all.filter((e) => e.date < start && isOpenEvent(e) && e.type !== "card_purchase" && e.direction !== "neutral" && e.status === "overdue").sort(byDate) : [];

  const grouped = new Map<ISODate, CalendarEvent[]>();
  for (const e of [...all].sort(byDate)) grouped.set(e.date, [...(grouped.get(e.date) ?? []), e]);
  const days = new Map([...grouped].map(([date, list]) => [date, dayOf(date, list)]));

  const cashOpenOut = (list: CalendarEvent[]) => list.filter((e) => isCashOut(e) && isOpenEvent(e));
  const monthOpen = cashOpenOut(events);
  const pending = [...cashOpenOut(carriedOverdue), ...monthOpen.filter((e) => e.status !== "planned")];
  const planned = monthOpen.filter((e) => e.status === "planned");
  const invoicesDue = events.filter((e) => e.type === "invoice" && isOpenEvent(e));
  const overdue = [...carriedOverdue, ...events.filter((e) => e.status === "overdue" && e.type !== "card_purchase" && e.direction !== "neutral")].filter(
    (e, index, list) => list.findIndex((x) => x.id === e.id) === index,
  );

  // Saldo projetado: o do Planejamento (mesmas regras) no fim deste mês; só com a visão de pessoa (os outros filtros
  // recortam itens que o saldo das contas não acompanha).
  const ahead = monthsBetween(currentMonth, month);
  const projectable = ahead >= 0 && ahead < PLANNING_MAX_MONTHS && !hasExtraFilters(f);
  const projectedBalanceCents = projectable ? (buildPlanning(data, { profileId, months: ahead + 1 }, today).months[ahead]?.endBalanceCents ?? null) : null;

  return {
    month,
    events,
    carriedOverdue,
    days,
    summary: {
      incomeReceivedCents: sum(events.filter((e) => e.type === "income" && e.status === "paid").map((e) => e.amountCents)),
      incomeOpenCents: sum(events.filter((e) => e.type === "income" && isOpenEvent(e)).map((e) => e.amountCents)),
      realizedExpensesCents: sum(events.filter((e) => e.realizedExpense).map((e) => e.amountCents)),
      pendingCents: sum(pending.map((e) => e.amountCents)),
      pendingCount: pending.length,
      plannedCents: sum(planned.map((e) => e.amountCents)),
      totalForecastCents: sum([...pending, ...planned].map((e) => e.amountCents)),
      invoicesDueCents: sum(invoicesDue.map((e) => e.amountCents)),
      invoicesDueCount: invoicesDue.length,
      overdueCents: sum(overdue.map((e) => e.amountCents)),
      overdueCount: overdue.length,
      projectedBalanceCents,
    },
    upcoming: upcomingEvents(
      all.filter((e) => e.date <= calendarHorizon(month, today)),
      today,
    ),
  };
}

// ---------- Grades (sem Date local: tudo em UTC sobre strings ISO) ----------

/** 0 = domingo. */
export function weekday(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Domingo a sábado que contêm `date`. */
export function weekOf(date: ISODate): ISODate[] {
  const first = addDays(date, -weekday(date));
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** Semanas (domingo a sábado) que cobrem o mês. */
export function monthGrid(month: string): { date: ISODate; inMonth: boolean }[][] {
  const first = monthStart(month);
  const last = monthEnd(month);
  const gridStart = addDays(first, -weekday(first));
  const weeks = Math.ceil((weekday(first) + daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(gridStart, w * 7 + d);
      return { date, inMonth: date >= first && date <= last };
    }),
  );
}

/** Mesmo dia em outro mês (limitado ao fim do mês: 31/01 + 1 = 28/02). */
export function moveMonth(date: ISODate, delta: number): ISODate {
  const target = shiftYearMonth(yearMonth(date), delta);
  return dateWithDay(Number(target.slice(0, 4)), Number(target.slice(5, 7)), Number(date.slice(8, 10)));
}

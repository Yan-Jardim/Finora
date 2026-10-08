"use client";

import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { Select } from "@/components/forms/fields";
import { useTransactionWindow, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  addDays,
  buildCalendar,
  CALENDAR_ALL,
  defaultCalendarFilters,
  hasExtraFilters,
  monthGrid,
  moveMonth,
  weekOf,
  weekday,
  type CalendarDay,
  type CalendarEvent,
  type CalendarFilters,
  type CalendarGroup,
  type CalendarStatusFilter,
} from "@/domain/calendar";
import { dateWithDay, yearMonth } from "@/domain/dates";
import { formatDate, formatMoney } from "@/lib/format";
import { monthName, monthTitle } from "@/lib/planning-messages";
import { calendarWindow } from "@/services/calendar-window";
import { cn } from "@/lib/utils";
import { CalendarDetailDialog } from "./calendar-detail";
import { EventButton, WEEKDAYS, WEEKDAYS_LONG } from "./calendar-parts";

type View = "month" | "week" | "list";
const VIEWS: { id: View; label: string }[] = [
  { id: "month", label: "Mensal" },
  { id: "week", label: "Semanal" },
  { id: "list", label: "Lista" },
];

const GROUPS: { id: CalendarGroup; label: string }[] = [
  { id: "all", label: "Todos os tipos" },
  { id: "income", label: "Receitas" },
  { id: "expense", label: "Despesas" },
  { id: "transfer", label: "Transferências" },
  { id: "invoice", label: "Faturas de cartão" },
  { id: "debt", label: "Dívidas" },
  { id: "recurring", label: "Recorrentes" },
  { id: "installment", label: "Parcelamentos" },
];

const STATUSES: { id: CalendarStatusFilter; label: string }[] = [
  { id: "all", label: "Todos os status" },
  { id: "paid", label: "Pago / recebido" },
  { id: "pending", label: "Pendente" },
  { id: "planned", label: "Previsto" },
  { id: "overdue", label: "Atrasado" },
];

const emptyDay = (date: string): CalendarDay => ({ date, events: [], inCents: 0, outCents: 0, cardCents: 0, overdue: false, open: false });

function Tile({ label, value, hint, tone, testId }: { label: string; value: string; hint?: string; tone?: string; testId: string }) {
  return (
    <Card className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <p className={cn("whitespace-nowrap text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", tone)}>{value}</p>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 font-normal text-foreground">
          {children}
        </Select>
      </label>
    </div>
  );
}

function DayCell({ day, date, today, selected, onOpen }: { day?: CalendarDay; date: string; today: string; selected: boolean; onOpen: (date: string) => void }) {
  const d = day ?? emptyDay(date);
  const isToday = date === today;
  const label = `${Number(date.slice(8))} de ${monthName(date.slice(0, 7))}: ${
    d.events.length === 0 ? "sem compromissos" : `${d.events.length} ${d.events.length === 1 ? "compromisso" : "compromissos"}`
  }${d.overdue ? ", com atrasados" : ""}${isToday ? ", hoje" : ""}`;
  return (
    <button
      type="button"
      onClick={() => onOpen(date)}
      aria-label={label}
      aria-current={isToday ? "date" : undefined}
      data-testid="calendar-day"
      data-date={date}
      data-count={d.events.length}
      className={cn(
        "flex min-h-14 min-w-0 flex-col items-stretch gap-1 rounded-lg border bg-card p-1 text-left transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary sm:min-h-24 sm:p-2",
        isToday ? "border-primary" : "border-border",
        selected && "ring-2 ring-primary",
        d.overdue && "bg-danger-soft",
      )}
    >
      <span className="flex items-center justify-between">
        <span className={cn("text-xs font-semibold tabular-nums sm:text-sm", isToday && "rounded-full bg-primary px-1.5 text-primary-foreground")}>{Number(date.slice(8))}</span>
        {d.overdue && <AlertTriangle className="size-3.5 text-danger" aria-hidden />}
      </span>
      {/* telas pequenas: marcadores (a leitura completa está no diálogo do dia) */}
      <span className="flex flex-wrap items-center gap-0.5 sm:hidden" aria-hidden>
        {d.inCents > 0 && <span className="size-1.5 rounded-full bg-success" />}
        {d.outCents > 0 && <span className="size-1.5 rounded-full bg-danger" />}
        {d.cardCents > 0 && <span className="size-1.5 rounded-full bg-primary" />}
        {d.events.length > 0 && <span className="text-[10px] leading-none text-muted-foreground">{d.events.length}</span>}
      </span>
      <span className="hidden flex-col gap-0.5 text-[11px] tabular-nums leading-tight sm:flex">
        {d.inCents > 0 && <span className="truncate text-success">+ {formatMoney(d.inCents)}</span>}
        {d.outCents > 0 && <span className="truncate text-danger">− {formatMoney(d.outCents)}</span>}
        {d.cardCents > 0 && <span className="truncate text-primary">Cartão {formatMoney(d.cardCents)}</span>}
        {d.events.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {d.events.length} {d.events.length === 1 ? "item" : "itens"}
          </span>
        )}
      </span>
    </button>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-success" aria-hidden /> Receita
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-danger" aria-hidden /> Despesa / dívida
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-primary" aria-hidden /> Cartão / transferência
      </li>
      <li>Status em texto: Pago, Pendente, Previsto, Atrasado</li>
    </ul>
  );
}

function groupByDate(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e]);
  return [...map];
}

/**
 * Calendário financeiro: compromissos por data (mensal, semanal, lista), derivados dos dados existentes. Só leitura:
 * pagar e editar continuam nas telas de Movimentações, Cartões e Dívidas.
 */
export function CalendarView() {
  const { data, ready, today } = useWorkspace();
  const [view, setView] = useState<View>("month");
  const [cursorState, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<CalendarFilters>(defaultCalendarFilters);
  const [dayDate, setDayDate] = useState<string | null>(null);
  const [event, setEvent] = useState<CalendarEvent | null>(null);

  const cursor = cursorState ?? today;
  const month = yearMonth(cursor);
  const week = useMemo(() => weekOf(cursor), [cursor]);
  const window = useMemo(() => calendarWindow(month, today, view === "week" ? { from: week[0], to: week[6] } : undefined), [month, today, view, week]);
  const { loading } = useTransactionWindow(window);

  const calendar = useMemo(() => (ready && !loading ? buildCalendar(data, month, filters, today) : null), [ready, loading, data, month, filters, today]);

  if (!ready) return <PageSkeleton />;

  const set = <K extends keyof CalendarFilters>(key: K, value: CalendarFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const step = (delta: number) => setCursor(view === "week" ? addDays(cursor, delta * 7) : moveMonth(cursor, delta));
  const year = Number(month.slice(0, 4));
  const years = Array.from({ length: 9 }, (_, i) => Number(today.slice(0, 4)) - 4 + i);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => a - b);
  const goTo = (y: number, m: number) => setCursor(dateWithDay(y, m, Number(cursor.slice(8, 10))));
  const rangeTitle = view === "week" ? `${formatDate(week[0])} a ${formatDate(week[6])}` : `${monthTitle(month)} ${year}`;

  const sourceEmpty = data.accounts.length === 0 && data.creditCards.length === 0;
  const dayOf = (date: string) => calendar?.days.get(date) ?? emptyDay(date);
  const openDay = (date: string) => {
    setEvent(null);
    setDayDate(date);
  };
  const openEvent = (e: CalendarEvent) => setEvent(e);
  const openEventAlone = (e: CalendarEvent) => {
    setDayDate(null);
    setEvent(e);
  };
  const summary = calendar?.summary;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Calendário" description="Seus compromissos financeiros por data: receitas, contas, faturas, parcelas e pagamentos." />

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => step(-1)} aria-label={view === "week" ? "Semana anterior" : "Mês anterior"}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => step(1)} aria-label={view === "week" ? "Próxima semana" : "Próximo mês"}>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setCursor(today)}>
              Hoje
            </Button>
          </div>
          <h2 className="min-w-0 flex-1 text-lg font-semibold tracking-tight" aria-live="polite" data-testid="calendar-title">
            {rangeTitle}
          </h2>
          <div className="flex gap-2">
            <Select aria-label="Mês" value={Number(month.slice(5, 7))} onChange={(e) => goTo(year, Number(e.target.value))} className="h-8 w-auto text-xs">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {monthTitle(`2000-${String(i + 1).padStart(2, "0")}`)}
                </option>
              ))}
            </Select>
            <Select aria-label="Ano" value={year} onChange={(e) => goTo(Number(e.target.value), Number(month.slice(5, 7)))} className="h-8 w-auto text-xs">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div role="tablist" aria-label="Visualização" className="inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto sm:self-start">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "h-8 flex-1 rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary sm:flex-none",
                view === v.id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <FilterSelect label="Pessoa" value={filters.profileId} onChange={(v) => set("profileId", v)}>
            <option value={CALENDAR_ALL}>Todos (consolidado)</option>
            {data.profiles
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.kind === "shared" ? " (casal)" : ""}
                </option>
              ))}
          </FilterSelect>
          <FilterSelect label="Conta" value={filters.accountId} onChange={(v) => set("accountId", v)}>
            <option value={CALENDAR_ALL}>Todas as contas</option>
            {data.accounts
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </FilterSelect>
          <FilterSelect label="Cartão" value={filters.cardId} onChange={(v) => set("cardId", v)}>
            <option value={CALENDAR_ALL}>Todos os cartões</option>
            {data.creditCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Categoria" value={filters.categoryId} onChange={(v) => set("categoryId", v)}>
            <option value={CALENDAR_ALL}>Todas as categorias</option>
            {data.categories
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </FilterSelect>
          <FilterSelect label="Tipo" value={filters.group} onChange={(v) => set("group", v as CalendarGroup)}>
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status" value={filters.status} onChange={(v) => set("status", v as CalendarStatusFilter)}>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </FilterSelect>
        </div>
        {(hasExtraFilters(filters) || filters.profileId !== CALENDAR_ALL) && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => setFilters(defaultCalendarFilters)}>
              Limpar filtros
            </Button>
          </div>
        )}
      </Card>

      {!calendar || !summary ? (
        <PageSkeleton />
      ) : sourceEmpty && calendar.events.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarDays} title="Nada para mostrar ainda" description="Cadastre contas, cartões e movimentações para ver seus compromissos no calendário." />
        </Card>
      ) : (
        <>
          {data.transactionsTruncated && (
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> Há mais movimentações no período do que o limite carregado: alguns itens podem não aparecer.
            </p>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Tile
              testId="cal-income"
              label="Receitas do mês"
              value={formatMoney(summary.incomeReceivedCents)}
              hint={summary.incomeOpenCents > 0 ? `+ ${formatMoney(summary.incomeOpenCents)} a receber` : "Recebidas no mês"}
              tone="text-success"
            />
            <Tile testId="cal-expenses" label="Despesas realizadas" value={formatMoney(summary.realizedExpensesCents)} hint="Já pagas ou lançadas no cartão" />
            <Tile
              testId="cal-pending"
              label="Compromissos pendentes"
              value={formatMoney(summary.pendingCents)}
              hint={summary.overdueCount > 0 ? `${summary.pendingCount} ${summary.pendingCount === 1 ? "item" : "itens"} · ${summary.overdueCount} em atraso (${formatMoney(summary.overdueCents)})` : `${summary.pendingCount} ${summary.pendingCount === 1 ? "item" : "itens"}`}
              tone={summary.overdueCount > 0 ? "text-danger" : undefined}
            />
            <Tile
              testId="cal-forecast"
              label="Total previsto"
              value={formatMoney(summary.totalForecastCents)}
              hint={`Pendentes + previstos (${formatMoney(summary.plannedCents)} previstos)`}
            />
            <Tile
              testId="cal-invoices"
              label="Faturas a vencer"
              value={formatMoney(summary.invoicesDueCents)}
              hint={summary.invoicesDueCount === 0 ? "Nenhuma fatura em aberto" : `${summary.invoicesDueCount} ${summary.invoicesDueCount === 1 ? "fatura" : "faturas"} no mês`}
              tone="text-primary"
            />
            <Tile
              testId="cal-projected"
              label="Saldo projetado"
              value={summary.projectedBalanceCents === null ? "—" : formatMoney(summary.projectedBalanceCents)}
              hint={summary.projectedBalanceCents === null ? (hasExtraFilters(filters) ? "Indisponível com esses filtros" : "Disponível do mês atual em diante (12 meses)") : "No fim do mês, pelo Planejamento"}
              tone={summary.projectedBalanceCents !== null && summary.projectedBalanceCents < 0 ? "text-danger" : undefined}
            />
          </div>

          {loading ? (
            <PageSkeleton />
          ) : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="flex min-w-0 flex-col gap-4">
                {calendar.carriedOverdue.length > 0 && (
                  <Card data-testid="calendar-carried">
                    <CardHeader title="Atrasados de meses anteriores" description="Mantêm a data original de vencimento" />
                    <ul className="flex flex-col gap-2">
                      {calendar.carriedOverdue.map((e) => (
                        <li key={e.id}>
                          <EventButton event={e} onSelect={openEventAlone} showDate />
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {view === "month" && (
                  <Card>
                    <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:gap-2" role="grid" aria-label={`Calendário de ${monthTitle(month)} ${year}`}>
                      {WEEKDAYS.map((w) => (
                        <div key={w} className="pb-1 text-center text-[11px] font-medium text-muted-foreground sm:text-xs" role="columnheader">
                          {w}
                        </div>
                      ))}
                      {monthGrid(month)
                        .flat()
                        .map((cell) =>
                          cell.inMonth ? (
                            <DayCell key={cell.date} date={cell.date} day={calendar.days.get(cell.date)} today={today} selected={dayDate === cell.date} onOpen={openDay} />
                          ) : (
                            <div key={cell.date} className="min-h-14 rounded-lg bg-muted/40 sm:min-h-24" aria-hidden />
                          ),
                        )}
                    </div>
                    <div className="mt-4">
                      <Legend />
                    </div>
                  </Card>
                )}

                {view === "week" && (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-7" data-testid="calendar-week">
                    {week.map((date) => {
                      const d = dayOf(date);
                      return (
                        <Card key={date} className={cn("flex flex-col gap-2 p-3", date === today && "border-primary")}>
                          <button type="button" onClick={() => openDay(date)} className="text-left focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Abrir ${formatDate(date)}`}>
                            <p className="text-xs text-muted-foreground">{WEEKDAYS_LONG[week.indexOf(date)]}</p>
                            <p className="font-semibold tabular-nums">{formatDate(date).slice(0, 5)}</p>
                          </button>
                          {d.events.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Sem compromissos</p>
                          ) : (
                            <ul className="flex flex-col gap-2">
                              {d.events.map((e) => (
                                <li key={e.id}>
                                  <EventButton event={e} onSelect={openEventAlone} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}

                {view === "list" && (
                  <Card data-testid="calendar-list">
                    <CardHeader title={`Compromissos de ${monthTitle(month)}`} description={`${calendar.events.length} ${calendar.events.length === 1 ? "item" : "itens"} no mês`} />
                    {calendar.events.length === 0 ? (
                      <EmptyState icon={ListChecks} title="Nada neste mês" description="Não há compromissos para este período e filtros." />
                    ) : (
                      <div className="flex flex-col gap-4">
                        {groupByDate(calendar.events).map(([date, list]) => (
                          <section key={date} aria-label={formatDate(date)}>
                            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                              {WEEKDAYS_LONG[weekday(date)]}, {formatDate(date)}
                            </h3>
                            <ul className="flex flex-col gap-2">
                              {list.map((e) => (
                                <li key={e.id}>
                                  <EventButton event={e} onSelect={openEventAlone} />
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    )}
                  </Card>
                )}

                {view !== "list" && calendar.events.length === 0 && (
                  <Card>
                    <EmptyState icon={CalendarDays} title="Nenhum compromisso neste mês" description="Receitas, contas, faturas e parcelas aparecem aqui quando existirem." />
                  </Card>
                )}
              </div>

              <aside aria-label="Próximos vencimentos" data-testid="calendar-upcoming">
                <Card>
                  <CardHeader title="Próximos vencimentos" description="Atrasados primeiro, com a data original" />
                  {calendar.upcoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nada a vencer por enquanto.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {calendar.upcoming.map((e) => (
                        <li key={e.id}>
                          <EventButton event={e} onSelect={openEventAlone} showDate />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </aside>
            </div>
          )}
        </>
      )}

      <CalendarDetailDialog
        day={dayDate ? dayOf(dayDate) : null}
        event={event}
        onSelectEvent={openEvent}
        onBack={() => setEvent(null)}
        onClose={() => {
          setEvent(null);
          setDayDate(null);
        }}
      />
    </div>
  );
}

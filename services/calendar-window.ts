import { calendarHorizon } from "@/domain/calendar";
import { monthEnd, monthStart } from "@/domain/dates";
import type { ISODate } from "@/domain/types";
import type { TransactionWindow } from "@/repositories/types";

/**
 * Janela de dados do Calendário: tudo (qualquer status) do mês visto — e da semana, quando ela atravessa meses —
 * mais os itens EM ABERTO até o fim do mês visto (ou do próximo mês, para "Próximos vencimentos" e atrasados).
 * Nunca o histórico inteiro. O saldo, as faturas e as parcelas de dívida vêm do snapshot (views).
 */
export function calendarWindow(month: string, today: ISODate, week?: { from: ISODate; to: ISODate }): TransactionWindow {
  const from = week && week.from < monthStart(month) ? week.from : monthStart(month);
  const to = week && week.to > monthEnd(month) ? week.to : monthEnd(month);
  return { from, to, openOnly: { until: calendarHorizon(month, today), cardSince: from, withWindow: true } };
}

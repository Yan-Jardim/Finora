import { AlertTriangle, CheckCircle2, CircleDashed, Clock } from "lucide-react";
import type { CalendarEvent, CalendarStatus } from "@/domain/calendar";
import { formatDayMonth, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const WEEKDAYS_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Status SEMPRE com ícone + texto (a cor reforça, nunca é o único sinal). */
export function statusMeta(event: Pick<CalendarEvent, "status" | "direction" | "type">): {
  label: string;
  icon: typeof Clock;
  className: string;
} {
  const status: CalendarStatus = event.status;
  if (status === "paid") {
    const label = event.type === "card_purchase" ? "Fatura paga" : event.direction === "in" ? "Recebido" : event.direction === "neutral" ? "Realizado" : "Pago";
    return { label, icon: CheckCircle2, className: "bg-success-soft text-success" };
  }
  if (status === "overdue") return { label: "Atrasado", icon: AlertTriangle, className: "bg-danger-soft text-danger" };
  if (status === "pending") {
    return { label: event.type === "card_purchase" ? "Na fatura" : event.direction === "in" ? "A receber" : "Pendente", icon: Clock, className: "bg-warning-soft text-warning" };
  }
  return { label: "Previsto", icon: CircleDashed, className: "bg-muted text-muted-foreground" };
}

export function EventStatus({ event, className }: { event: Pick<CalendarEvent, "status" | "direction" | "type">; className?: string }) {
  const meta = statusMeta(event);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.className, className)}>
      <meta.icon className="size-3" aria-hidden />
      {meta.label}
    </span>
  );
}

/** Verde = receita; vermelho = despesa/dívida; roxo (primária) = cartão/transferência. */
export function eventTone(event: Pick<CalendarEvent, "type" | "direction">): { text: string; bar: string } {
  if (event.type === "income") return { text: "text-success", bar: "bg-success" };
  if (event.type === "expense" || event.type === "debt_installment" || event.type === "debt_payment") return { text: "text-danger", bar: "bg-danger" };
  return { text: "text-primary", bar: "bg-primary" };
}

export const eventSign = (event: Pick<CalendarEvent, "direction">) => (event.direction === "in" ? "+ " : event.direction === "out" ? "− " : "");

export function EventButton({
  event,
  onSelect,
  showDate,
}: {
  event: CalendarEvent;
  onSelect: (event: CalendarEvent) => void;
  showDate?: boolean;
}) {
  const tone = eventTone(event);
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      data-testid="calendar-event"
      aria-label={`${event.title}, ${eventSign(event)}${formatMoney(event.amountCents)}, ${statusMeta(event).label}${event.date ? `, ${formatDayMonth(event.date)}` : ""}`}
      className="flex w-full items-stretch gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span className={cn("w-1 shrink-0 rounded-full", tone.bar)} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{event.title}</span>
          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", tone.text)}>
            {eventSign(event)}
            {formatMoney(event.amountCents)}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {showDate && <span className="tabular-nums">{formatDayMonth(event.date)}</span>}
          <span>{event.subtitle}</span>
          {event.installmentLabel && <span>· {event.installmentLabel}</span>}
          <EventStatus event={event} />
        </span>
      </span>
    </button>
  );
}

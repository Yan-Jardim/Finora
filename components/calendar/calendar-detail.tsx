"use client";

import { ArrowLeft, Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays } from "lucide-react";
import type { CalendarDay, CalendarEvent } from "@/domain/calendar";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WEEKDAYS_LONG, EventButton, EventStatus, eventSign, eventTone } from "./calendar-parts";
import { weekday } from "@/domain/calendar";

const LINK_LABEL: Record<string, string> = {
  "/movimentacoes": "Abrir em Movimentações",
  "/cartoes": "Abrir em Cartões (pagar fatura)",
  "/dividas": "Abrir em Dívidas",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** Detalhe de um evento. Conta em aberto pode ser marcada como paga aqui; o resto acontece nas telas existentes (link). */
function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { data, commands } = useWorkspace();
  const run = useAction();
  const payable = event.type === "expense" && event.status !== "paid" ? data.transactions.find((t) => t.id === event.transactionId) : undefined;
  const markPaid = async () => {
    if (payable && (await run(() => commands.setStatus(payable, "paid"), `${event.title}: paga ✅`))) onClose();
  };
  const profile = data.profiles.find((p) => p.id === event.profileId);
  const account = data.accounts.find((a) => a.id === event.accountId);
  const toAccount = data.accounts.find((a) => a.id === event.toAccountId);
  const card = data.creditCards.find((c) => c.id === event.cardId);
  const category = data.categories.find((c) => c.id === event.categoryId);
  const tone = eventTone(event);
  return (
    <div className="flex flex-col gap-4" data-testid="calendar-event-detail">
      <div>
        <p className={cn("text-2xl font-semibold tabular-nums", tone.text)}>
          {eventSign(event)}
          {formatMoney(event.amountCents)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <EventStatus event={event} />
          <span className="text-xs text-muted-foreground">{event.subtitle}</span>
        </div>
      </div>
      <dl className="flex flex-col gap-2 border-t border-border pt-3">
        <Row label={event.status === "paid" ? "Data" : "Vencimento"}>{formatDate(event.date)}</Row>
        {profile && <Row label="Responsável">{profile.name}</Row>}
        {account && <Row label={toAccount ? "Conta de origem" : "Conta"}>{account.name}</Row>}
        {toAccount && <Row label="Conta de destino">{toAccount.name}</Row>}
        {card && <Row label="Cartão">{card.name}</Row>}
        {category && <Row label="Categoria">{category.name}</Row>}
        {event.installmentLabel && <Row label="Parcela">{event.installmentLabel}</Row>}
        {event.recurring && <Row label="Origem">Recorrência</Row>}
        {event.paidCents !== undefined && event.totalCents !== undefined && (
          <>
            <Row label="Valor total">{formatMoney(event.totalCents)}</Row>
            <Row label="Já pago">{formatMoney(event.paidCents)}</Row>
            <Row label="Em aberto">{formatMoney(event.amountCents)}</Row>
          </>
        )}
      </dl>
      {event.type === "card_purchase" && (
        <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          Compra no cartão: o dinheiro só sai quando a fatura é paga, por isso ela não entra nos compromissos pendentes.
        </p>
      )}
      {event.type === "card_payment" && (
        <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">Pagamento de fatura não é uma nova despesa: as compras já foram contadas.</p>
      )}
      {payable && (
        <Button onClick={markPaid} data-testid="calendar-mark-paid">
          <Check className="size-4" aria-hidden /> Marcar como pago
        </Button>
      )}
      <Link
        href={event.href}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ExternalLink className="size-4" aria-hidden /> {LINK_LABEL[event.href] ?? "Abrir"}
      </Link>
      <p className="text-xs text-muted-foreground">Faturas, parcelas e edições são feitas na tela indicada.</p>
    </div>
  );
}

/** Dia (todos os compromissos) e, dentro dele, o detalhe de um evento. */
export function CalendarDetailDialog({
  day,
  event,
  onSelectEvent,
  onBack,
  onClose,
}: {
  day: CalendarDay | null;
  event: CalendarEvent | null;
  onSelectEvent: (event: CalendarEvent) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const open = !!event || !!day;
  const title = event ? event.title : day ? `${WEEKDAYS_LONG[weekday(day.date)]}, ${formatDate(day.date)}` : "";
  const description = event ? undefined : day ? (day.events.length === 0 ? "Nada neste dia" : `${day.events.length} ${day.events.length === 1 ? "compromisso" : "compromissos"}`) : undefined;
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      {event ? (
        <div className="flex flex-col gap-4">
          {day && (
            <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden /> Voltar ao dia
            </Button>
          )}
          <EventDetail event={event} onClose={onClose} />
        </div>
      ) : day ? (
        day.events.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nenhum compromisso" description="Não há receitas, contas, faturas ou parcelas neste dia." />
        ) : (
          <div className="flex flex-col gap-3" data-testid="calendar-day-detail">
            <dl className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-success-soft p-2 text-success">
                <dt>Receitas</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(day.inCents)}</dd>
              </div>
              <div className="rounded-xl bg-danger-soft p-2 text-danger">
                <dt>Saídas</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(day.outCents)}</dd>
              </div>
              <div className="rounded-xl bg-primary-soft p-2 text-primary">
                <dt>No cartão</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(day.cardCents)}</dd>
              </div>
            </dl>
            <ul className="flex flex-col gap-2">
              {day.events.map((e) => (
                <li key={e.id}>
                  <EventButton event={e} onSelect={onSelectEvent} />
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </Dialog>
  );
}

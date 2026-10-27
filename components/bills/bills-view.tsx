"use client";

import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCopy, CreditCard, Landmark, ListPlus, Receipt, Repeat, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAction, useTransactionWindow, useWorkspace } from "@/components/providers/workspace-provider";
import { useToast } from "@/components/providers/toast-provider";
import { PayInvoiceDialog } from "@/components/cards/pay-invoice-dialog";
import { DebtPaymentDialog } from "@/components/debts/debt-payment-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PageSkeleton } from "@/components/ui/skeleton";
import { billsAsText, buildMonthBills, type MonthBill } from "@/domain/bills";
import { CALENDAR_ALL, moveMonth } from "@/domain/calendar";
import { yearMonth } from "@/domain/dates";
import { snapshotOf } from "@/domain/snapshot";
import { formatDayMonth, formatMoney } from "@/lib/format";
import { monthTitle } from "@/lib/planning-messages";
import { cn } from "@/lib/utils";
import { calendarWindow } from "@/services/calendar-window";
import { PasteBillsDialog } from "./paste-bills-dialog";

const sourceIcon = { bill: Receipt, invoice: CreditCard, debt: Landmark } as const;

function BillRow({
  bill,
  profileName,
  profileColor,
  onPay,
  onUndo,
}: {
  bill: MonthBill;
  profileName?: string;
  profileColor?: string;
  onPay?: () => void;
  onUndo?: () => void;
}) {
  const Icon = sourceIcon[bill.source];
  const paid = bill.status === "paid";
  const overdue = bill.status === "overdue";
  const details = [
    profileName,
    bill.source === "invoice" ? "Fatura" : bill.source === "debt" ? "Dívida" : undefined,
    bill.recurring ? "todo mês" : undefined,
    bill.installmentLabel ? `parcela ${bill.installmentLabel}` : undefined,
  ].filter(Boolean);
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" data-testid="bill-row" data-status={bill.status}>
      <div className="w-11 shrink-0 text-center">
        <p className={cn("text-sm font-semibold tabular-nums", overdue && "text-danger")}>{formatDayMonth(bill.date).slice(0, 2)}</p>
        <p className="text-[10px] uppercase text-muted-foreground">{formatDayMonth(bill.date).slice(3)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("flex items-start gap-1.5 text-sm font-medium", paid && "text-muted-foreground line-through decoration-1")}>
          <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="line-clamp-2 break-words">{bill.title}</span>
          {bill.recurring && <Repeat className="mt-1 size-3 shrink-0 text-muted-foreground" aria-label="Todo mês" />}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          {profileColor && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: profileColor }} aria-hidden />}
          <span>{details.join(" · ")}</span>
          {overdue && (
            <span className="inline-flex items-center gap-1 font-medium text-danger">
              <AlertTriangle className="size-3" aria-hidden /> Atrasada
            </span>
          )}
          {paid && (
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <CheckCircle2 className="size-3" aria-hidden /> Paga
            </span>
          )}
        </p>
      </div>
      <span className={cn("whitespace-nowrap text-sm font-semibold tabular-nums", paid && "text-muted-foreground")}>{formatMoney(bill.amountCents)}</span>
      {onPay && (
        <Button size="sm" variant="secondary" onClick={onPay} aria-label={`Marcar ${bill.title} como paga`} data-testid="bill-pay">
          <Check className="size-4" aria-hidden />
          <span className="hidden sm:inline">Pago</span>
        </Button>
      )}
      {onUndo && (
        <Button size="sm" variant="ghost" onClick={onUndo} aria-label={`Desfazer pagamento de ${bill.title}`}>
          <Undo2 className="size-4" aria-hidden />
        </Button>
      )}
    </li>
  );
}

/**
 * Contas do mês: a lista que antes ficava no WhatsApp. Tudo o que vence no mês (contas, mensais, faturas e parcelas),
 * "Pago" com um toque e o total que falta. Pagar fatura/parcela abre o mesmo diálogo de Cartões/Dívidas.
 */
export function BillsView() {
  const { data, ready, today, commands } = useWorkspace();
  const run = useAction();
  const toast = useToast();
  const [cursorState, setCursor] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string>(CALENDAR_ALL);
  const [pasting, setPasting] = useState(false);
  const [invoice, setInvoice] = useState<MonthBill | null>(null);
  const [debtBill, setDebtBill] = useState<MonthBill | null>(null);

  const cursor = cursorState ?? today;
  const month = yearMonth(cursor);
  const window = useMemo(() => calendarWindow(month, today), [month, today]);
  const { loading } = useTransactionWindow(window);
  const bills = useMemo(() => (ready && !loading ? buildMonthBills(data, month, profileId, today) : null), [ready, loading, data, month, profileId, today]);

  if (!ready) return <PageSkeleton />;

  const profiles = data.profiles.filter((p) => p.active);
  const profileById = new Map(data.profiles.map((p) => [p.id, p]));
  const label = `${monthTitle(month)} ${month.slice(0, 4)}`;
  const txOf = (bill: MonthBill) => data.transactions.find((t) => t.id === bill.transactionId);

  const pay = (bill: MonthBill) => {
    if (bill.source === "invoice") return setInvoice(bill);
    if (bill.source === "debt") return setDebtBill(bill);
    const tx = txOf(bill);
    if (tx) run(() => commands.setStatus(tx, "paid"), `${bill.title}: paga ✅`);
  };
  const undo = (bill: MonthBill) => {
    const tx = txOf(bill);
    if (tx) run(() => commands.setStatus(tx, "pending"), `${bill.title} voltou para a lista.`);
  };
  const copy = async () => {
    if (!bills) return;
    try {
      await navigator.clipboard.writeText(billsAsText(bills, label, formatMoney));
      toast.success("Lista copiada. É só colar no WhatsApp.");
    } catch {
      toast.error("Não foi possível copiar a lista.");
    }
  };

  const invoiceCard = invoice ? data.creditCards.find((c) => c.id === invoice.cardId) : undefined;
  const debt = debtBill ? data.debts.find((d) => d.id === debtBill.debtId) : undefined;
  const debtSummary = debt ? snapshotOf(data, today).debts.find((s) => s.debtId === debt.id) : undefined;
  const paidPercent = bills && bills.totalCents > 0 ? (bills.paidCents / bills.totalCents) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contas do mês"
        description="O que vocês pagam no mês: marque como pago e veja quanto falta."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={copy} disabled={!bills}>
              <ClipboardCopy className="size-4" aria-hidden /> Copiar lista
            </Button>
            <Button onClick={() => setPasting(true)} data-testid="bills-add">
              <ListPlus className="size-4" aria-hidden /> Adicionar contas
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => setCursor(moveMonth(cursor, -1))} aria-label="Mês anterior">
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <h2 className="min-w-36 text-center text-lg font-semibold tracking-tight" aria-live="polite" data-testid="bills-month">
            {label}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setCursor(moveMonth(cursor, 1))} aria-label="Próximo mês">
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          {month !== yearMonth(today) && (
            <Button variant="ghost" size="sm" onClick={() => setCursor(today)}>
              Este mês
            </Button>
          )}
        </div>
        <div role="group" aria-label="Filtrar por pessoa" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
          {[{ id: CALENDAR_ALL, name: "Todos", color: undefined as string | undefined }, ...profiles].map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={profileId === p.id}
              onClick={() => setProfileId(p.id)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
                profileId === p.id ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.color && <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />}
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {!bills ? (
        <PageSkeleton />
      ) : (
        <>
          <Card className="flex flex-col gap-3" data-testid="bills-summary">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total pendente — {monthTitle(month)}</p>
                <p className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="bills-open-total">
                  {formatMoney(bills.openCents)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-warning-soft px-2.5 py-1 font-medium text-warning">
                  {bills.open.length} {bills.open.length === 1 ? "conta a pagar" : "contas a pagar"}
                </span>
                {bills.overdueCount > 0 && (
                  <span className="rounded-full bg-danger-soft px-2.5 py-1 font-medium text-danger">
                    {bills.overdueCount} {bills.overdueCount === 1 ? "atrasada" : "atrasadas"}
                  </span>
                )}
                <span className="rounded-full bg-success-soft px-2.5 py-1 font-medium text-success">
                  {bills.paid.length} {bills.paid.length === 1 ? "paga" : "pagas"}
                </span>
              </div>
            </div>
            <ProgressBar value={paidPercent} label="Quanto do mês já foi pago" color="var(--success)" />
            <p className="text-xs text-muted-foreground">
              Pago {formatMoney(bills.paidCents)} de {formatMoney(bills.totalCents)}
            </p>
          </Card>

          <Card>
            <h2 className="mb-4 text-sm font-semibold">A pagar</h2>
            {bills.open.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title={bills.paid.length > 0 ? "Tudo pago neste mês" : "Nenhuma conta neste mês"}
                description={bills.paid.length > 0 ? "Boa! Não falta nada." : "Use \"Adicionar contas\" e cole a lista que vocês mandam no WhatsApp."}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border" data-testid="bills-open">
                {bills.open.map((bill) => (
                  <BillRow
                    key={bill.id}
                    bill={bill}
                    profileName={profileById.get(bill.profileId)?.name}
                    profileColor={profileById.get(bill.profileId)?.color}
                    onPay={() => pay(bill)}
                  />
                ))}
              </ul>
            )}
          </Card>

          {bills.paid.length > 0 && (
            <Card>
              <h2 className="mb-4 text-sm font-semibold">Pagas</h2>
              <ul className="flex flex-col divide-y divide-border" data-testid="bills-paid">
                {bills.paid.map((bill) => (
                  <BillRow
                    key={bill.id}
                    bill={bill}
                    profileName={profileById.get(bill.profileId)?.name}
                    profileColor={profileById.get(bill.profileId)?.color}
                    onUndo={bill.transactionId ? () => undo(bill) : undefined}
                  />
                ))}
              </ul>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            Para editar ou excluir uma conta, use <Link href="/movimentacoes" className="underline">Movimentações</Link>; as que se repetem ficam em{" "}
            <Link href="/recorrencias" className="underline">Recorrências</Link>. Os vencimentos também aparecem no{" "}
            <Link href="/calendario" className="underline">Calendário</Link>.
          </p>
        </>
      )}

      {pasting && bills && <PasteBillsDialog month={month} bills={bills} defaultProfileId={profileId} onClose={() => setPasting(false)} />}
      <PayInvoiceDialog card={invoiceCard} initialMonth={invoice ? yearMonth(invoice.date) : undefined} onClose={() => setInvoice(null)} />
      <DebtPaymentDialog debt={debt} summary={debtSummary} mode="pay" onClose={() => setDebtBill(null)} />
    </div>
  );
}

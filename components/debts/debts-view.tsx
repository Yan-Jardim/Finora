"use client";

import { Banknote, CheckCheck, Landmark, Pencil, Pause, Play, Plus, RotateCcw, Wallet } from "lucide-react";
import { useState } from "react";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PageSkeleton } from "@/components/ui/skeleton";
import { sum } from "@/domain/calculations";
import type { DebtSummary } from "@/domain/debts";
import { snapshotOf } from "@/domain/snapshot";
import type { Debt } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { debtKindLabel } from "@/schemas/debt";
import { DebtFormDialog } from "./debt-form";
import { DebtPaymentDialog, type DebtPaymentMode } from "./debt-payment-dialog";

const statusLabel = { active: "Ativa", paused: "Pausada", paid: "Quitada", canceled: "Cancelada" } as const;
const statusTone = { active: "success", paused: "warning", paid: "primary", canceled: "neutral" } as const;

function SummaryTile({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Wallet }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div>
        <p className="whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
    </Card>
  );
}

/**
 * Dívidas e empréstimos. A dívida é o CONTRATO (não soma em nada); as parcelas são derivadas e o pago/restante vem do
 * snapshot (views do banco ou derivado das transações). Só os pagamentos movem saldo (Movimentações, selo "Dívida").
 */
export function DebtsView() {
  const { data, ready, debtCommands, today } = useWorkspace();
  const run = useAction();
  const [form, setForm] = useState<{ open: boolean; debt?: Debt }>({ open: false });
  const [paying, setPaying] = useState<{ debt: Debt; mode: DebtPaymentMode } | undefined>();
  const [canceling, setCanceling] = useState<Debt | undefined>();

  if (!ready) return <PageSkeleton />;

  const snapshot = snapshotOf(data, today);
  const summaryOf = new Map<string, DebtSummary>(snapshot.debts.map((s) => [s.debtId, s]));
  const profiles = new Map(data.profiles.map((p) => [p.id, p]));
  const rows = data.debts
    .map((debt) => ({ debt, s: summaryOf.get(debt.id) }))
    .filter((r): r is { debt: Debt; s: DebtSummary } => !!r.s);

  const ongoing = rows.filter((r) => r.s.status === "active" || r.s.status === "paused");
  const closed = rows.filter((r) => r.s.status === "paid" || r.s.status === "canceled");
  const month = today.slice(0, 7);
  // "Parcelas deste mês": o que vence no mês e ainda está em aberto (dívidas ativas).
  const thisMonth = snapshot.debtInstallments.filter(
    (i) => i.openCents > 0 && i.dueDate.slice(0, 7) === month && ongoing.some((r) => r.s.debtId === i.debtId && r.s.status === "active"),
  );

  const newButton = (
    <Button onClick={() => setForm({ open: true })}>
      <Plus className="size-4" aria-hidden /> Nova dívida
    </Button>
  );

  const card = ({ debt, s }: { debt: Debt; s: DebtSummary }) => {
    const owner = profiles.get(debt.profileId);
    const overdue = snapshot.debtInstallments.filter((i) => i.debtId === debt.id && i.overdue);
    const settledOrPaid = s.status === "paid";
    return (
      <li key={debt.id}>
        <Card className={cn("flex h-full flex-col gap-4", (s.status === "canceled" || s.status === "paused") && "opacity-80")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{debt.name}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full" style={{ backgroundColor: owner?.color }} aria-hidden />
                  {owner?.name ?? "—"}
                </span>
                {debt.creditor && <span aria-hidden>•</span>}
                {debt.creditor && <span>{debt.creditor}</span>}
                <span aria-hidden>•</span>
                <span>{debtKindLabel[debt.kind]}</span>
              </p>
            </div>
            <Badge tone={statusTone[s.status]}>{statusLabel[s.status]}</Badge>
          </div>

          <div>
            <p className="text-sm">
              <strong className="tabular-nums">{formatMoney(s.totalCents)}</strong> total ·{" "}
              <span className="tabular-nums text-success">{formatMoney(s.paidCents)}</span> pagos ·{" "}
              <span className="tabular-nums">{formatMoney(s.remainingCents)}</span> restantes
            </p>
            <div className="mt-2">
              <ProgressBar value={s.progressPercent} color="var(--primary)" label={`Progresso de ${debt.name}`} />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {Math.round(s.progressPercent)}%
                {s.installmentsCount ? ` · ${s.installmentsPaid} de ${s.installmentsCount} parcelas pagas` : ` · ${s.paymentsCount} ${s.paymentsCount === 1 ? "pagamento" : "pagamentos"}`}
              </p>
            </div>
          </div>

          {s.nextDueDate && s.status !== "paid" && s.status !== "canceled" && (
            <p className={cn("text-sm", overdue.length > 0 ? "text-danger" : "text-muted-foreground")}>
              {overdue.length > 0 ? `${overdue.length} ${overdue.length === 1 ? "parcela atrasada" : "parcelas atrasadas"} · ` : ""}
              Próxima: <strong className="text-foreground">{formatDate(s.nextDueDate)}</strong> — {formatMoney(s.nextOpenCents ?? 0)}
            </p>
          )}
          {s.financialCostCents > 0 && (
            <p className="text-xs text-muted-foreground">
              Custo financeiro {formatMoney(s.financialCostCents)} (≈ {Math.round((s.financialCostCents / s.principalCents) * 100)}% sobre {formatMoney(s.principalCents)}).
            </p>
          )}
          {s.settledAt && (
            <p className="text-xs text-muted-foreground">
              Quitada em {formatDate(s.settledAt)} com desconto de <strong className="text-foreground">{formatMoney(s.settlementDiscountCents ?? 0)}</strong> sobre o saldo projetado.
            </p>
          )}

          <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
            {(s.status === "active" || s.status === "paused") && (
              <Button size="sm" onClick={() => setPaying({ debt, mode: "pay" })}>
                <Banknote className="size-3.5" aria-hidden /> Pagar parcela
              </Button>
            )}
            {(s.status === "active" || s.status === "paused") && (
              <Button variant="secondary" size="sm" onClick={() => setPaying({ debt, mode: "settle" })}>
                <CheckCheck className="size-3.5" aria-hidden /> Quitar
              </Button>
            )}
            <Button variant="ghost" size="sm" aria-label={`Editar ${debt.name}`} onClick={() => setForm({ open: true, debt })}>
              <Pencil className="size-3.5" aria-hidden /> Editar
            </Button>
            {(s.status === "active" || s.status === "paused") && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${s.status === "active" ? "Pausar" : "Ativar"} ${debt.name}`}
                onClick={() =>
                  run(
                    () => debtCommands.setStatus(debt, s.status === "active" ? "paused" : "active"),
                    s.status === "active" ? "Dívida pausada: não entra mais no disponível." : "Dívida reativada.",
                  )
                }
              >
                {s.status === "active" ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                {s.status === "active" ? "Pausar" : "Ativar"}
              </Button>
            )}
            {debt.settledAt && (
              <Button variant="ghost" size="sm" aria-label={`Reabrir ${debt.name}`} onClick={() => run(() => debtCommands.reopen(debt), "Dívida reaberta: o desconto voltou ao saldo devido.")}>
                <RotateCcw className="size-3.5" aria-hidden /> Reabrir
              </Button>
            )}
            {s.paymentsCount === 0 && (s.status === "active" || s.status === "paused") && !settledOrPaid && (
              <Button variant="ghost" size="sm" className="ml-auto text-danger" aria-label={`Cancelar ${debt.name}`} onClick={() => setCanceling(debt)}>
                Cancelar
              </Button>
            )}
          </div>
        </Card>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dívidas"
        description="Empréstimos, financiamentos e dinheiro que você deve. Só os pagamentos movem o saldo."
        action={rows.length > 0 ? newButton : undefined}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title="Nenhuma dívida cadastrada"
            description="Cadastre um empréstimo ou uma dívida pessoal para acompanhar parcelas, pagamentos e quanto falta."
          />
          <div className="flex justify-center pb-6">{newButton}</div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryTile label="Total devido" value={formatMoney(sum(ongoing.map((r) => r.s.totalCents)))} hint="Dívidas em andamento" icon={Landmark} />
            <SummaryTile label="Pago" value={formatMoney(sum(ongoing.map((r) => r.s.paidCents)))} hint="Já saiu das suas contas" icon={Banknote} />
            <SummaryTile label="Restante" value={formatMoney(sum(ongoing.map((r) => r.s.remainingCents)))} hint="Ainda falta pagar" icon={Wallet} />
            <SummaryTile
              label="Parcelas deste mês"
              value={formatMoney(sum(thisMonth.map((i) => i.openCents)))}
              hint={thisMonth.length === 0 ? "Nada a vencer" : `${thisMonth.length} ${thisMonth.length === 1 ? "parcela em aberto" : "parcelas em aberto"}`}
              icon={CheckCheck}
            />
          </div>

          {ongoing.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma dívida em andamento. 🎉</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">{ongoing.map(card)}</ul>
          )}

          {closed.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Quitadas e canceladas ({closed.length})</summary>
              <ul className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">{closed.map(card)}</ul>
            </details>
          )}
        </>
      )}

      <DebtFormDialog key={form.debt?.id ?? "new"} open={form.open} onClose={() => setForm({ open: false })} debt={form.debt} locked={!!form.debt?.settledAt} />

      <DebtPaymentDialog
        key={`${paying?.debt.id}-${paying?.mode}`}
        debt={paying?.debt}
        summary={paying ? summaryOf.get(paying.debt.id) : undefined}
        mode={paying?.mode ?? "pay"}
        onClose={() => setPaying(undefined)}
      />

      <ConfirmDialog
        open={!!canceling}
        onClose={() => setCanceling(undefined)}
        title={`Cancelar "${canceling?.name}"?`}
        description="Use só para um cadastro feito por engano. A dívida deixa de contar, e o histórico é mantido. Dívidas com pagamentos devem ser quitadas, não canceladas."
        confirmLabel="Cancelar dívida"
        onConfirm={() => run(() => debtCommands.setStatus(canceling!, "canceled"), "Dívida cancelada.")}
      />
    </div>
  );
}

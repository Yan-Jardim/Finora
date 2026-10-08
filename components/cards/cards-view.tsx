"use client";

import { CreditCard as CardIcon, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PageSkeleton } from "@/components/ui/skeleton";
import { cardSummaryFrom, sum } from "@/domain/calculations";
import { snapshotCardInvoices, snapshotOf, snapshotUsedLimit } from "@/domain/snapshot";
import { cardDeleteBlocker } from "@/domain/rules";
import type { CreditCard } from "@/domain/types";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { cardBrandLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { CardFormDialog } from "./card-form";
import { PayInvoiceDialog } from "./pay-invoice-dialog";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function CardsView() {
  const { data, ready, repos, today } = useWorkspace();
  const run = useAction();
  const [form, setForm] = useState<{ open: boolean; card?: CreditCard }>({ open: false });
  const [deleting, setDeleting] = useState<CreditCard | undefined>();
  const [paying, setPaying] = useState<{ card: CreditCard; month?: string } | undefined>();

  if (!ready) return <PageSkeleton />;

  const profileMap = new Map(data.profiles.map((p) => [p.id, p]));
  const accountMap = new Map(data.accounts.map((a) => [a.id, a]));
  const active = data.creditCards.filter((c) => c.active);
  const totalLimit = sum(active.map((c) => c.limitCents));
  // Fatura, utilizado e disponível vêm do snapshot (views do banco no modo supabase).
  const snapshot = snapshotOf(data, today);
  const summaryOf = (card: CreditCard) =>
    cardSummaryFrom(card, snapshotCardInvoices(snapshot, card.id), snapshotUsedLimit(snapshot, card), today);
  const totalUsed = sum(active.map((c) => snapshotUsedLimit(snapshot, c)));

  const newButton = (
    <Button onClick={() => setForm({ open: true })}>
      <Plus className="size-4" aria-hidden /> Novo cartão
    </Button>
  );

  const summary = [
    { label: "Limite total", value: totalLimit },
    { label: "Utilizado", value: totalUsed },
    { label: "Disponível", value: totalLimit - totalUsed },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cartões"
        description="Cartões de crédito, limites e datas de fatura."
        action={data.creditCards.length > 0 ? newButton : undefined}
      />

      {data.creditCards.length === 0 ? (
        <Card>
          <EmptyState
            icon={CardIcon}
            title="Nenhum cartão cadastrado"
            description="Cadastre seu primeiro cartão para acompanhar limite, fechamento e vencimento."
          />
          <div className="flex justify-center pb-6">{newButton}</div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {summary.map((item) => (
              <Card key={item.label} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
                <p className="text-2xl font-semibold tracking-tight tabular-nums">{formatMoney(item.value)}</p>
                <span className="text-xs text-muted-foreground">Somente cartões ativos</span>
              </Card>
            ))}
          </div>

          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.creditCards.map((card) => {
              const summary = summaryOf(card);
              const used = summary.usedCents;
              const percent = (used / card.limitCents) * 100;
              const owner = profileMap.get(card.ownerProfileId);
              return (
                <li key={card.id}>
                  <Card className={cn("flex h-full flex-col gap-4 overflow-hidden p-0", !card.active && "opacity-60")}>
                    <div className="h-1.5" style={{ backgroundColor: card.color }} aria-hidden />
                    <div className="flex flex-col gap-4 px-5 pb-5 pt-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{card.name}</p>
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="size-2 rounded-full" style={{ backgroundColor: owner?.color }} aria-hidden />
                            {owner?.name ?? "—"}
                            {card.brand && ` · ${cardBrandLabel[card.brand]}`}
                            {card.last4 && ` · •••• ${card.last4}`}
                          </p>
                        </div>
                        <StatusBadge active={card.active} />
                      </div>

                      <div>
                        <ProgressBar
                          value={percent}
                          color={percent > 80 ? "var(--danger)" : card.color}
                          label={`Limite usado em ${card.name}`}
                        />
                        <p className="mt-1.5 text-xs text-muted-foreground">{formatPercent(percent)} do limite utilizado</p>
                      </div>

                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                        <Stat label="Limite" value={formatMoney(card.limitCents)} />
                        <Stat label="Utilizado" value={formatMoney(used)} />
                        <Stat label="Disponível" value={formatMoney(card.limitCents - used)} />
                        <Stat label="Fatura atual" value={formatMoney(summary.current.totalCents - summary.current.paidCents)} />
                        <Stat label="Próxima fatura" value={formatMoney(summary.next.totalCents - summary.next.paidCents)} />
                        <Stat label="Fechamento / Venc." value={`Dia ${card.closingDay} / ${card.dueDay}`} />
                      </dl>
                      {card.accountId && (
                        <p className="text-xs text-muted-foreground">Conta padrão para pagar: {accountMap.get(card.accountId)?.name ?? "—"}.</p>
                      )}

                      {summary.closedOpen.map((invoice) => (
                        <div key={invoice.dueMonth} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-soft px-3 py-2">
                          <p className="text-sm text-warning">
                            Fatura fechada: <strong>{formatMoney(invoice.openCents)}</strong> vence em {formatDate(invoice.dueDate)}
                          </p>
                          <Button size="sm" onClick={() => setPaying({ card, month: invoice.dueMonth })}>
                            Pagar fatura
                          </Button>
                        </div>
                      ))}

                      {!owner?.active && owner && <Badge tone="warning">Proprietário inativo</Badge>}

                      <div className="mt-auto flex gap-2 border-t border-border pt-3">
                        <Button variant="secondary" size="sm" onClick={() => setForm({ open: true, card })}>
                          <Pencil className="size-3.5" aria-hidden /> Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            run(
                              () => repos.creditCards.update(card.id, { active: !card.active }),
                              card.active ? "Cartão desativado." : "Cartão ativado.",
                            )
                          }
                        >
                          <Power className="size-3.5" aria-hidden /> {card.active ? "Desativar" : "Ativar"}
                        </Button>
                        {summary.payable.length > 0 && summary.closedOpen.length === 0 && (
                          <Button variant="ghost" size="sm" onClick={() => setPaying({ card })}>
                            Pagar fatura
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="ml-auto" aria-label={`Excluir ${card.name}`} onClick={() => setDeleting(card)}>
                          <Trash2 className="size-3.5 text-danger" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <PayInvoiceDialog key={paying?.card.id + (paying?.month ?? "")} card={paying?.card} initialMonth={paying?.month} onClose={() => setPaying(undefined)} />

      <CardFormDialog open={form.open} onClose={() => setForm({ open: false })} card={form.card} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title={`Excluir "${deleting?.name}"?`}
        description="Esta ação não pode ser desfeita."
        blockedReason={deleting ? (cardDeleteBlocker(deleting, data) ?? undefined) : undefined}
        onConfirm={() => run(() => repos.creditCards.remove(deleting!.id), "Cartão excluído.")}
      />
    </div>
  );
}

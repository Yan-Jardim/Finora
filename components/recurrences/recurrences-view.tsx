"use client";

import { Pause, Pencil, Play, Plus, Repeat } from "lucide-react";
import { useState } from "react";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { describeSchedule, nextOccurrence } from "@/domain/recurrence";
import type { RecurringTransaction } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { transactionKindLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { RecurrenceFormDialog } from "./recurrence-form";

const kindTone = { income: "text-success", expense: "text-danger", credit_card_purchase: "text-danger" } as const;

/**
 * Recorrências: templates que geram as movimentações. Esta tela só lista/edita/pausa o TEMPLATE; os valores que
 * entram em saldo e dashboard são sempre as ocorrências geradas (em Movimentações). Sem exclusão destrutiva.
 */
export function RecurrencesView() {
  const { data, ready, recurrence, today } = useWorkspace();
  const run = useAction();
  const [form, setForm] = useState<{ open: boolean; rule?: RecurringTransaction }>({ open: false });

  if (!ready) return <PageSkeleton />;

  const profiles = new Map(data.profiles.map((p) => [p.id, p]));
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const cards = new Map(data.creditCards.map((c) => [c.id, c]));

  const rows = data.recurringTransactions
    .map((rule) => ({ rule, next: nextOccurrence(rule, today) }))
    .sort(
      (a, b) =>
        Number(b.rule.active) - Number(a.rule.active) ||
        (a.next ?? "9999").localeCompare(b.next ?? "9999") ||
        a.rule.description.localeCompare(b.rule.description, "pt-BR"),
    );

  const newButton = (
    <Button onClick={() => setForm({ open: true })}>
      <Plus className="size-4" aria-hidden /> Nova recorrência
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recorrências"
        description="Cadastre uma vez; as próximas ocorrências (até 12 meses) são geradas como movimentações previstas."
        action={rows.length > 0 ? newButton : undefined}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Repeat}
            title="Nenhuma recorrência cadastrada"
            description="Salário, aluguel, internet, assinaturas, IPVA… cadastre uma vez e o Finora gera as ocorrências."
          />
          <div className="flex justify-center pb-6">{newButton}</div>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map(({ rule, next }) => {
            const owner = profiles.get(rule.profileId);
            const place = rule.cardId ? cards.get(rule.cardId)?.name : accounts.get(rule.accountId ?? "")?.name;
            const category = categories.get(rule.categoryId);
            const ended = rule.active && next === null;
            return (
              <li key={rule.id}>
                <Card className={cn("flex h-full flex-col gap-3", !rule.active && "opacity-70")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{rule.description}</p>
                      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span className="size-2 rounded-full" style={{ backgroundColor: owner?.color }} aria-hidden />
                          {owner?.name ?? "—"}
                        </span>
                        {category && <span aria-hidden>•</span>}
                        {category && <span>{category.name}</span>}
                        <span aria-hidden>•</span>
                        <span>{place ?? "—"}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cn("text-lg font-semibold tabular-nums", kindTone[rule.kind])}>
                        {rule.kind === "income" ? "+" : "−"}
                        {formatMoney(rule.amountCents)}
                      </span>
                      <Badge tone={rule.active ? (ended ? "neutral" : "success") : "warning"}>
                        {!rule.active ? "Pausada" : ended ? "Encerrada" : "Ativa"}
                      </Badge>
                    </div>
                  </div>

                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Frequência</dt>
                      <dd className="font-medium">{describeSchedule(rule)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Próxima ocorrência</dt>
                      <dd className="font-medium">{rule.active && next ? formatDate(next) : "—"}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {transactionKindLabel[rule.kind]}
                    {rule.endDate ? ` • até ${formatDate(rule.endDate)}` : ""}
                    {rule.tags.length > 0 ? ` • ${rule.tags.map((t) => `#${t}`).join(" ")}` : ""}
                  </p>

                  <div className="mt-auto flex gap-2 border-t border-border pt-3">
                    <Button variant="secondary" size="sm" aria-label={`Editar ${rule.description}`} onClick={() => setForm({ open: true, rule })}>
                      <Pencil className="size-3.5" aria-hidden /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${rule.active ? "Pausar" : "Ativar"} ${rule.description}`}
                      onClick={() =>
                        run(
                          () => recurrence.setActive(rule, !rule.active),
                          rule.active
                            ? "Recorrência pausada. As ocorrências futuras previstas foram canceladas (reversível)."
                            : "Recorrência ativada. As próximas ocorrências foram geradas.",
                        )
                      }
                    >
                      {rule.active ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                      {rule.active ? "Pausar" : "Ativar"}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <RecurrenceFormDialog key={form.rule?.id ?? "new"} open={form.open} onClose={() => setForm({ open: false })} rule={form.rule} />
    </div>
  );
}

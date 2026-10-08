"use client";

import { Link2, Link2Off, Pencil, PiggyBank, Plus, Target, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ProfileFilter } from "@/components/dashboard/profile-filter";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryIcon } from "@/components/ui/category-icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PageSkeleton } from "@/components/ui/skeleton";
import type { Goal } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { goalKindLabel, goalStatusLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { ALL, buildGoalsView, type GoalCard } from "@/services/pocket-view";
import { GoalFormDialog } from "./goal-form";
import { GoalLinkDialog } from "./goal-link-dialog";

const statusTone = { active: "success", paused: "warning", completed: "primary", canceled: "neutral" } as const;

function deadlineText(days: number | undefined, deadline: string | undefined): { text: string; late: boolean } | null {
  if (days === undefined || !deadline) return null;
  if (days < 0) return { text: `Prazo vencido em ${formatDate(deadline)}`, late: true };
  if (days === 0) return { text: `Prazo: hoje (${formatDate(deadline)})`, late: false };
  return { text: `Prazo: ${formatDate(deadline)} · faltam ${days} ${days === 1 ? "dia" : "dias"}`, late: false };
}

/**
 * Objetivos. Ligado a um cofrinho: progresso = saldo REAL do cofrinho ("Reservado em cofrinho"). Manual: valor informado
 * ("Progresso informado manualmente"), visualmente distinto (barra tracejada) e NUNCA dinheiro reservado.
 */
export function GoalsView() {
  const { data, ready, today } = useWorkspace();
  const run = useAction();
  const { repos } = useWorkspace();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<{ open: boolean; goal?: Goal }>({ open: false });
  const [linking, setLinking] = useState<Goal | undefined>();
  const [deleting, setDeleting] = useState<Goal | undefined>();

  if (!ready) return <PageSkeleton />;

  const profileParam = searchParams.get("perfil") ?? ALL;
  const profileId = data.profiles.some((p) => p.id === profileParam) ? profileParam : ALL;
  const view = buildGoalsView(data, today, profileId);
  const profiles = new Map(data.profiles.map((p) => [p.id, p]));
  const total = view.active.length + view.closed.length;

  const newButton = (
    <Button onClick={() => setForm({ open: true })}>
      <Plus className="size-4" aria-hidden /> Novo objetivo
    </Button>
  );

  const card = ({ goal, progress, pocket, daysLeft }: GoalCard) => {
    const owner = profiles.get(goal.profileId);
    const manual = progress.source === "manual";
    const deadline = deadlineText(daysLeft, goal.deadline);
    return (
      <li key={goal.id}>
        <Card className={cn("flex h-full flex-col gap-4", (goal.status === "canceled" || goal.status === "paused") && "opacity-80")} aria-label={`Objetivo ${goal.name}`}>
          <div className="flex items-start gap-3">
            <CategoryIcon name={goal.icon} color={goal.color} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{goal.name}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full" style={{ backgroundColor: owner?.color }} aria-hidden />
                  {owner?.name ?? "—"}
                </span>
                <span aria-hidden>•</span>
                <span>{goalKindLabel[goal.kind]}</span>
              </p>
            </div>
            <Badge tone={statusTone[goal.status]}>{progress.reached && goal.status === "active" ? "Meta atingida" : goalStatusLabel[goal.status]}</Badge>
          </div>

          {goal.description && <p className="text-xs text-muted-foreground">{goal.description}</p>}

          <div>
            <p className="text-sm">
              <strong className="tabular-nums" data-testid="goal-current">
                {formatMoney(progress.currentCents)}
              </strong>{" "}
              de <span className="tabular-nums">{formatMoney(goal.targetCents)}</span>
              <span className="text-muted-foreground"> · {Math.round(progress.percent)}%</span>
            </p>
            <div className={cn("mt-2", manual && "rounded-full outline-1 outline-dashed outline-offset-2 outline-border")}>
              <ProgressBar value={progress.percent} color={manual ? "var(--muted-foreground)" : goal.color} label={`Progresso de ${goal.name}`} />
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground" data-testid="goal-source">
              {manual ? (
                <span className="inline-flex items-center gap-1">
                  <Pencil className="size-3" aria-hidden /> Progresso informado manualmente
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-foreground">
                  <PiggyBank className="size-3" aria-hidden /> Reservado em cofrinho{pocket ? `: ${pocket.name}` : ""}
                </span>
              )}
              <span aria-hidden>·</span>
              <span>Faltam {formatMoney(progress.remainingCents)}</span>
            </p>
            {manual && <p className="mt-1 text-[11px] text-muted-foreground">Valor informado: não é dinheiro reservado e não entra no disponível nem no patrimônio.</p>}
          </div>

          {deadline && <p className={cn("text-xs", deadline.late && goal.status === "active" ? "text-danger" : "text-muted-foreground")}>{deadline.text}</p>}

          <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="secondary" size="sm" aria-label={`${goal.pocketId ? "Cofrinho de" : "Vincular cofrinho a"} ${goal.name}`} onClick={() => setLinking(goal)}>
              {goal.pocketId ? <Link2Off className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
              {goal.pocketId ? "Alterar vínculo" : "Vincular cofrinho"}
            </Button>
            <Button variant="ghost" size="sm" aria-label={`Editar ${goal.name}`} onClick={() => setForm({ open: true, goal })}>
              <Pencil className="size-3.5" aria-hidden /> Editar
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto text-danger" aria-label={`Excluir ${goal.name}`} onClick={() => setDeleting(goal)}>
              <Trash2 className="size-3.5" aria-hidden /> Excluir
            </Button>
          </div>
        </Card>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Objetivos"
        description="Metas com valor e prazo. Vincule um cofrinho para acompanhar o dinheiro realmente reservado."
        action={total > 0 ? newButton : undefined}
      />

      <ProfileFilter profiles={data.profiles} selected={profileId} basePath="/objetivos" />

      {total === 0 ? (
        <Card>
          <EmptyState icon={Target} title="Nenhum objetivo ainda" description="Crie um objetivo — por exemplo, uma viagem ou a reserva de emergência — e acompanhe o progresso." />
          <div className="flex justify-center pb-6">{newButton}</div>
        </Card>
      ) : (
        <>
          {view.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum objetivo em andamento.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{view.active.map(card)}</ul>
          )}
          {view.closed.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Concluídos e cancelados ({view.closed.length})</summary>
              <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{view.closed.map(card)}</ul>
            </details>
          )}
        </>
      )}

      <GoalFormDialog key={form.goal?.id ?? "new"} open={form.open} onClose={() => setForm({ open: false })} goal={form.goal} />
      <GoalLinkDialog goal={linking} onClose={() => setLinking(undefined)} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title={`Excluir "${deleting?.name}"?`}
        description="O objetivo será removido. O cofrinho vinculado e o dinheiro reservado continuam intactos."
        onConfirm={() => run(() => repos.goals.remove(deleting!.id), "Objetivo excluído.")}
      />
    </div>
  );
}

import { PiggyBank, Target } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { ID, ISODate, WorkspaceData } from "@/domain/types";
import { formatMoney } from "@/lib/format";
import { buildGoalsView, buildPocketsView } from "@/services/pocket-view";

/**
 * Cofrinhos e objetivos no dashboard. Informativo: o reservado já está descontado do "Disponível de verdade" e NADA aqui
 * altera patrimônio (o dinheiro continua nas contas). Respeita o filtro de pessoa/Casal.
 */
export function PocketsOverview({ data, today, profileId }: { data: WorkspaceData; today: ISODate; profileId: ID | "all" }) {
  const pockets = buildPocketsView(data, today, profileId);
  const goals = buildGoalsView(data, today, profileId);
  const activeGoals = goals.active.filter((g) => g.goal.status === "active");

  if (pockets.active.length === 0 && pockets.archived.length === 0 && activeGoals.length === 0) return null;
  const top = activeGoals.slice(0, 3);

  return (
    <Card aria-label="Cofrinhos e objetivos">
      <CardHeader
        title="Cofrinhos e objetivos"
        description="Dinheiro separado dentro das contas"
        action={
          <Link href="/cofrinhos" className="text-xs font-medium text-primary hover:underline">
            Ver cofrinhos
          </Link>
        }
      />
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <PiggyBank className="size-3.5" aria-hidden /> Total reservado
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums" data-testid="dash-reserved">
            {formatMoney(pockets.reservedCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Dinheiro livre</dt>
          <dd className="mt-0.5 font-semibold tabular-nums" data-testid="dash-free">
            {formatMoney(pockets.freeCents)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <Target className="size-3.5" aria-hidden /> Objetivos ativos
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums" data-testid="dash-goals">
            {activeGoals.length}
          </dd>
        </div>
      </dl>

      {top.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          {top.map(({ goal, progress }) => (
            <li key={goal.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{goal.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatMoney(progress.currentCents)} de {formatMoney(goal.targetCents)}
                </span>
              </div>
              <ProgressBar className="mt-1.5" value={progress.percent} color={progress.source === "manual" ? "var(--muted-foreground)" : goal.color} label={`Progresso de ${goal.name}`} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {Math.round(progress.percent)}% · {progress.source === "manual" ? "informado manualmente" : "reservado em cofrinho"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

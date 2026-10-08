"use client";

import { AlertTriangle, CheckCircle2, Info, LineChart } from "lucide-react";
import { useMemo, useState } from "react";
import { Select } from "@/components/forms/fields";
import { useTransactionWindow, useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { monthEnd, monthStart, shiftYearMonth } from "@/domain/dates";
import { ALL_PROFILES_FILTER, buildPlanning, PLANNING_MAX_MONTHS, type SimulationComparison } from "@/domain/planning";
import { formatMoney } from "@/lib/format";
import { alertMessage, monthTitle } from "@/lib/planning-messages";
import { cn } from "@/lib/utils";
import { MonthDetailDialog } from "./month-detail";
import { ProjectionChart } from "./projection-chart";
import { PurchaseSimulator } from "./purchase-simulator";

const PERIODS = [
  { months: 1, label: "Mês atual" },
  { months: 3, label: "3 meses" },
  { months: 6, label: "6 meses" },
  { months: 12, label: "12 meses" },
];

const alertStyle = {
  danger: { icon: AlertTriangle, box: "bg-danger-soft text-danger" },
  warning: { icon: AlertTriangle, box: "bg-warning-soft text-warning" },
  info: { icon: Info, box: "bg-primary-soft text-primary" },
} as const;

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <p className={cn("whitespace-nowrap text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", tone)}>{value}</p>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </Card>
  );
}

/**
 * Planejamento: projeção de FLUXO DE CAIXA dos próximos 12 meses, derivada dos dados reais (nada é gravado).
 * No Supabase carrega só os itens em aberto até o fim do horizonte; saldo, faturas e parcelas de dívida vêm das views.
 */
export function PlanningView() {
  const { data, ready, today } = useWorkspace();
  const [profileId, setProfileId] = useState(ALL_PROFILES_FILTER);
  const [months, setMonths] = useState(PLANNING_MAX_MONTHS);
  const [selected, setSelected] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationComparison | null>(null);

  const first = today.slice(0, 7);
  const last = shiftYearMonth(first, PLANNING_MAX_MONTHS - 1);
  const { loading } = useTransactionWindow({
    from: monthStart(first),
    to: monthEnd(last),
    openOnly: { until: monthEnd(last), cardSince: monthStart(shiftYearMonth(first, -2)) },
  });

  const filters = useMemo(() => ({ profileId, months }), [profileId, months]);
  const planning = useMemo(() => (ready && !loading ? buildPlanning(data, filters, today) : null), [ready, loading, data, filters, today]);

  if (!ready || loading || !planning) return <PageSkeleton />;

  if (data.accounts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Planejamento" description="Como ficam seu saldo e seus compromissos nos próximos meses." />
        <Card>
          <EmptyState icon={LineChart} title="Cadastre suas contas primeiro" description="O planejamento parte do saldo atual das suas contas." />
        </Card>
      </div>
    );
  }

  const nothing = planning.totalIncomeCents === 0 && planning.totalOutflowCents === 0;
  const detail = planning.months.find((m) => m.month === selected);
  const points = planning.months.map((m) => ({ month: m.month, value: m.endBalanceCents }));
  const comparePoints = simulation?.withPurchase.months.slice(0, planning.months.length).map((m) => ({ month: m.month, value: m.endBalanceCents }));
  const lowest = planning.lowest;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Planejamento" description="Como ficam seu saldo e seus compromissos nos próximos meses (fluxo de caixa)." />

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="plan-profile" className="mb-1 block text-xs font-medium text-muted-foreground">
            Visão
          </label>
          <Select id="plan-profile" aria-label="Filtrar por pessoa" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value={ALL_PROFILES_FILTER}>Todos (consolidado)</option>
            {data.profiles
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.kind === "shared" ? " (casal)" : ""}
                </option>
              ))}
          </Select>
        </div>
        <div className="flex-1">
          <label htmlFor="plan-period" className="mb-1 block text-xs font-medium text-muted-foreground">
            Período
          </label>
          <Select id="plan-period" aria-label="Período" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {PERIODS.map((p) => (
              <option key={p.months} value={p.months}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        <CardHeader title="Alertas" description="Calculados a partir dos seus dados reais" />
        {planning.alerts.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden /> Nenhum alerta: nada atrasado e o saldo projetado fica positivo no período.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Alertas do planejamento">
            {planning.alerts.map((alert) => {
              const style = alertStyle[alert.severity];
              return (
                <li key={alert.id} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-sm", style.box)}>
                  <style.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {alertMessage(alert)}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Saldo inicial projetado" value={formatMoney(planning.startBalanceCents)} hint="Saldo atual das contas (sem investimentos)" />
        <Tile
          label="Saldo final projetado"
          value={formatMoney(planning.endBalanceCents)}
          hint={`Em ${monthTitle(planning.months.at(-1)!.month)}`}
          tone={planning.endBalanceCents < 0 ? "text-danger" : undefined}
        />
        <Tile
          label="Menor saldo no período"
          value={lowest ? formatMoney(lowest.balanceCents) : "—"}
          hint={lowest ? monthTitle(lowest.month) : ""}
          tone={lowest && lowest.balanceCents < 0 ? "text-danger" : undefined}
        />
        <Tile
          label="Atrasados"
          value={formatMoney(planning.overdue.cents)}
          hint={planning.overdue.count === 0 ? "Nada atrasado" : `${planning.overdue.count} ${planning.overdue.count === 1 ? "item" : "itens"} em atraso`}
          tone={planning.overdue.count > 0 ? "text-danger" : undefined}
        />
      </div>

      {planning.reservedCents > 0 && (
        <Card className="flex flex-col gap-1" aria-label="Dinheiro reservado">
          <span className="text-xs font-medium text-muted-foreground">Dinheiro reservado em cofrinhos</span>
          <p className="text-sm">
            <strong className="tabular-nums" data-testid="plan-reserved">{formatMoney(planning.reservedCents)}</strong> do saldo inicial já tem destino ·
            livre hoje: <strong className="tabular-nums" data-testid="plan-free">{formatMoney(planning.startBalanceCents - planning.reservedCents)}</strong>
            {" "}· livre no fim do período, se a reserva não mudar:{" "}
            <strong className="tabular-nums" data-testid="plan-free-end">{formatMoney(planning.endBalanceCents - planning.reservedCents)}</strong>
          </p>
          <span className="text-xs text-muted-foreground">Informação apenas: a projeção continua partindo do saldo real das contas.</span>
        </Card>
      )}

      {nothing ? (
        <Card>
          <EmptyState
            icon={LineChart}
            title="Nada previsto neste período"
            description="Cadastre receitas, contas a pagar, recorrências, compras no cartão ou dívidas para ver a projeção."
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Evolução do saldo projetado"
              description={simulation ? "A linha tracejada mostra o saldo com a compra simulada." : "Saldo no fim de cada mês, a partir do saldo de hoje"}
            />
            <ProjectionChart points={points} compare={comparePoints} label="Evolução do saldo projetado nos próximos meses" />
          </Card>

          <section aria-label="Meses">
            <h2 className="mb-3 text-sm font-semibold">Mês a mês</h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {planning.months.map((m, index) => (
                <li key={m.month}>
                  <button
                    type="button"
                    onClick={() => setSelected(m.month)}
                    aria-label={`Detalhes de ${monthTitle(m.month)}`}
                    className="w-full rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">
                        {monthTitle(m.month)} <span className="text-xs font-normal text-muted-foreground">{m.month.slice(0, 4)}</span>
                      </p>
                      {index === 0 && <Badge tone="primary">Mês atual</Badge>}
                    </div>
                    <dl className="mt-3 flex flex-col gap-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Receitas previstas</dt>
                        <dd className="tabular-nums text-success">+ {formatMoney(m.incomeCents)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Saídas previstas</dt>
                        <dd className="tabular-nums">− {formatMoney(m.outflowCents)}</dd>
                      </div>
                      <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
                        <dt>Saldo projetado</dt>
                        <dd className={cn("tabular-nums", m.endBalanceCents < 0 && "text-danger")}>{formatMoney(m.endBalanceCents)}</dd>
                      </div>
                    </dl>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <PurchaseSimulator filters={filters} onResult={setSimulation} />

      <MonthDetailDialog month={detail} onClose={() => setSelected(null)} />
    </div>
  );
}

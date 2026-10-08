import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  Landmark,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { DashboardData } from "@/services/dashboard-service";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "default" | "success" | "warning" | "danger";

const toneStyles: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  highlight = false,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  highlight?: boolean;
}) {
  return (
    <Card className={cn("flex flex-col gap-3", highlight && "border-primary/40 bg-primary-soft")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", toneStyles[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Card>
  );
}

export function SummaryCards({ summary }: { summary: DashboardData["summary"] }) {
  const negativeAvailable = summary.availableCents < 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <div className="sm:col-span-1 lg:col-span-2">
        <SummaryCard
          label="Saldo em contas"
          value={formatMoney(summary.balanceCents)}
          hint={`+ Investimentos ${formatMoney(summary.investmentsCents)} = Patrimônio ${formatMoney(summary.netWorthCents)}`}
          icon={Landmark}
        />
      </div>
      <div className="sm:col-span-1 lg:col-span-2">
        <SummaryCard
          label="Receitas"
          value={formatMoney(summary.incomeCents)}
          hint={summary.incomePendingCents ? `A receber: ${formatMoney(summary.incomePendingCents)}` : "Tudo recebido"}
          icon={ArrowUpCircle}
          tone="success"
        />
      </div>
      <div className="sm:col-span-1 lg:col-span-2">
        <SummaryCard
          label="Despesas"
          value={formatMoney(summary.spentCents)}
          hint="Realizadas no mês (pagas ou no cartão)"
          icon={ArrowDownCircle}
          tone="danger"
        />
      </div>
      <div className="sm:col-span-1 lg:col-span-3">
        <SummaryCard
          label="Gastos previstos"
          value={formatMoney(summary.plannedCents)}
          hint={`Pendentes ${formatMoney(summary.plannedPendingCents)} · Futuros ${formatMoney(summary.plannedFutureCents)}`}
          icon={CalendarClock}
          tone="warning"
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <SummaryCard
          label="Disponível de verdade"
          value={formatMoney(summary.availableCents)}
          hint="Saldo menos contas, faturas, dívidas e reservas do mês"
          icon={ShieldCheck}
          tone={negativeAvailable ? "danger" : "success"}
          highlight
        />
      </div>
    </div>
  );
}

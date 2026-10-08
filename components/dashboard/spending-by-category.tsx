import { PieChart } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { CategoryIcon } from "@/components/ui/category-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatMoney, formatPercent } from "@/lib/format";
import type { CategorySpending } from "@/services/dashboard-service";

export function SpendingByCategory({
  items,
  totalCents,
  excludedCents,
}: {
  items: CategorySpending[];
  /** Total realizado — igual ao card "Despesas". */
  totalCents: number;
  /** Pendentes + futuras, que NÃO entram neste gráfico. */
  excludedCents: number;
}) {
  const shown = items.slice(0, 6);
  const rest = items.slice(6);
  const restCents = rest.reduce((total, item) => total + item.amountCents, 0);
  const rows = restCents
    ? [...shown, { categoryId: "rest", name: "Demais categorias", icon: "more", color: "#71717a", amountCents: restCents, percent: (restCents / totalCents) * 100 }]
    : shown;

  return (
    <Card>
      <CardHeader title="Gastos realizados por categoria" description="Despesas já realizadas no mês, por categoria principal" />
      {items.length === 0 ? (
        <EmptyState icon={PieChart} title="Sem despesas realizadas no período" description="Quando houver despesas realizadas, a distribuição aparece aqui." />
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((item) => (
            <li key={item.categoryId} className="flex items-center gap-3">
              <CategoryIcon name={item.icon} color={item.color} />
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(item.amountCents)}
                    <span className="ml-2 text-xs text-muted-foreground">{formatPercent(item.percent)}</span>
                  </span>
                </div>
                <ProgressBar value={item.percent} color={item.color} label={`${item.name}: ${formatPercent(item.percent)}`} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <footer className="mt-5 flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>
            Total realizado: <strong className="text-foreground tabular-nums">{formatMoney(totalCents)}</strong>
          </span>
          {excludedCents > 0 && <span>Pendentes e previstos ({formatMoney(excludedCents)}) não estão incluídos.</span>}
        </footer>
      )}
    </Card>
  );
}

import { CheckCircle2, CreditCard, Landmark, Receipt } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDayMonth, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UpcomingItem } from "@/services/dashboard-service";

const typeIcon = { bill: Receipt, invoice: CreditCard, debt: Landmark } as const;

export function UpcomingBills({ items }: { items: UpcomingItem[] }) {
  return (
    <Card>
      <CardHeader
        title="Próximas contas"
        description="Vencimentos em aberto neste mês"
        action={
          <Link href="/contas-do-mes" className="text-xs font-medium text-primary hover:underline">
            Contas do mês
          </Link>
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nenhuma conta em aberto" description="Você está em dia neste mês." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.slice(0, 7).map((item) => {
            const Icon = typeIcon[item.type];
            return (
              <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="w-11 shrink-0 text-center">
                  <p className="text-sm font-semibold tabular-nums">{formatDayMonth(item.date).slice(0, 2)}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">{formatDayMonth(item.date).slice(3)}</p>
                </div>
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className={cn("text-xs", item.overdue ? "text-danger" : "text-muted-foreground")}>
                    {item.overdue ? "Atrasada" : item.subtitle}
                  </p>
                </div>
                <span className="text-sm font-medium tabular-nums">{formatMoney(item.amountCents)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

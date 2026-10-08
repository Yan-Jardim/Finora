import { ArrowLeftRight, Receipt } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { CategoryIcon } from "@/components/ui/category-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatMoney } from "@/lib/format";
import { statusLabel, transactionKindLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { TransactionKind, TransactionStatus } from "@/domain/types";
import type { RecentTransaction } from "@/services/dashboard-service";

/** Movimentos que só trocam o dinheiro de lugar não são entrada nem saída de patrimônio. */
const neutralKinds: TransactionKind[] = ["transfer", "investment", "redemption", "card_payment"];

const statusStyle: Record<TransactionStatus, string> = {
  paid: "bg-success-soft text-success",
  pending: "bg-warning-soft text-warning",
  planned: "bg-muted text-muted-foreground",
  overdue: "bg-danger-soft text-danger",
  canceled: "bg-muted text-muted-foreground",
};

export function RecentTransactions({ items }: { items: RecentTransaction[] }) {
  return (
    <Card>
      <CardHeader title="Últimas movimentações" />
      {items.length === 0 ? (
        <EmptyState icon={Receipt} title="Nenhuma movimentação ainda" description="Suas receitas e despesas aparecerão aqui." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => {
            const neutral = neutralKinds.includes(item.kind);
            const income = item.kind === "income";
            return (
              <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                {neutral ? (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <ArrowLeftRight className="size-4" aria-hidden />
                  </span>
                ) : (
                  <CategoryIcon name={item.categoryIcon} color={item.categoryColor} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.description}
                    {item.installmentLabel && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{item.installmentLabel}</span>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.profileColor }} aria-hidden />
                    {item.profileName} · {item.contextLabel} · {formatDate(item.date)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={cn(
                      "text-sm font-medium tabular-nums",
                      income && "text-success",
                      neutral && "text-muted-foreground",
                    )}
                  >
                    {income ? "+" : neutral ? "" : "−"} {formatMoney(item.amountCents)}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusStyle[item.status])}>
                    {neutral ? transactionKindLabel[item.kind] : statusLabel(item.kind, item.status)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

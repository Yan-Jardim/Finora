import { Card, CardHeader } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardData } from "@/services/dashboard-service";

export function AvailableBreakdown({ data }: { data: DashboardData["availableBreakdown"] }) {
  const rows = [
    { label: "Saldo atual", value: data.balanceCents, sign: "" },
    { label: "Contas restantes", value: data.remainingBillsCents, sign: "−" },
    { label: "Faturas do mês", value: data.invoicesCents, sign: "−" },
    { label: "Dívidas a pagar", value: data.debtsCents, sign: "−" },
    { label: "Dinheiro reservado", value: data.reservedCents, sign: "−" },
  ];

  return (
    <Card>
      <CardHeader title="Quanto posso gastar?" description="Do saldo ao que realmente está livre" />
      <dl className="flex flex-col gap-2.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tabular-nums">
              {row.sign} {formatMoney(row.value)}
            </dd>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t border-border pt-3 font-semibold">
          <dt>Disponível de verdade</dt>
          <dd className={cn("tabular-nums", data.availableCents < 0 ? "text-danger" : "text-success")}>
            {formatMoney(data.availableCents)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

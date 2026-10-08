"use client";

import { Dialog } from "@/components/ui/dialog";
import type { PlanningItem, PlanningMonth } from "@/domain/planning";
import { formatDate, formatMoney } from "@/lib/format";
import { monthTitle } from "@/lib/planning-messages";
import { cn } from "@/lib/utils";

const SECTIONS: { title: string; hint?: string; match: (i: PlanningItem) => boolean }[] = [
  { title: "Receitas previstas", match: (i) => i.type === "income" },
  { title: "Contas e despesas", match: (i) => i.type === "bill" && !i.recurring },
  { title: "Despesas recorrentes", match: (i) => i.type === "bill" && i.recurring },
  { title: "Faturas de cartão", hint: "O que sai da conta quando a fatura é paga (já inclui as compras abaixo de cada uma).", match: (i) => i.type === "invoice" },
  { title: "Parcelas de dívidas", match: (i) => i.type === "debt" },
  { title: "Transferências para fora do saldo em contas", match: (i) => i.type === "transfer" },
  { title: "Simulação", match: (i) => i.type === "simulation" },
];

function Row({ item }: { item: PlanningItem }) {
  const income = item.direction === "in";
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDate(item.date).slice(0, 5)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <p className={cn("text-xs", item.overdue ? "text-danger" : "text-muted-foreground")}>
            {item.overdue ? `Atrasada · venceu em ${formatDate(item.dueDate)}` : item.subtitle}
          </p>
        </div>
        <span className={cn("shrink-0 text-sm font-medium tabular-nums", income ? "text-success" : "text-foreground")}>
          {income ? "+" : "−"} {formatMoney(item.amountCents)}
        </span>
      </div>
      {item.type === "invoice" && item.parts && (
        <details className="ml-15 mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {item.parts.length} {item.parts.length === 1 ? "compra" : "compras"} nesta fatura
            {item.invoicePaidCents ? ` · já pago ${formatMoney(item.invoicePaidCents)} de ${formatMoney(item.invoiceTotalCents ?? 0)}` : ""}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-3">
            {item.parts.map((p, i) => (
              <li key={`${p.title}-${i}`} className="flex justify-between gap-2">
                <span className="truncate">
                  {formatDate(p.date).slice(0, 5)} · {p.title}
                  {p.label ? ` (${p.label})` : ""}
                </span>
                <span className="tabular-nums">{formatMoney(p.amountCents)}</span>
              </li>
            ))}
            {!!item.unlistedCents && (
              <li className="flex justify-between gap-2 italic">
                <span>Compras anteriores / não listadas</span>
                <span className="tabular-nums">{formatMoney(item.unlistedCents)}</span>
              </li>
            )}
          </ul>
        </details>
      )}
    </li>
  );
}

/** O que forma os números de um mês: receitas, contas, recorrências, faturas e parcelas de dívida. */
export function MonthDetailDialog({ month, onClose }: { month?: PlanningMonth; onClose: () => void }) {
  return (
    <Dialog
      open={!!month}
      onClose={onClose}
      title={month ? monthTitle(month.month) : ""}
      description="Os compromissos que formam as entradas e saídas previstas deste mês."
    >
      {month && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Saldo inicial</dt>
              <dd className="text-sm font-semibold tabular-nums">{formatMoney(month.startBalanceCents)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Receitas</dt>
              <dd className="text-sm font-semibold tabular-nums text-success">+ {formatMoney(month.incomeCents)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Saídas</dt>
              <dd className="text-sm font-semibold tabular-nums">− {formatMoney(month.outflowCents)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Saldo projetado</dt>
              <dd className={cn("text-sm font-semibold tabular-nums", month.endBalanceCents < 0 && "text-danger")}>{formatMoney(month.endBalanceCents)}</dd>
            </div>
          </dl>

          {month.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nada previsto para este mês.</p>
          ) : (
            SECTIONS.map((section) => {
              const items = month.items.filter(section.match);
              if (items.length === 0) return null;
              return (
                <section key={section.title}>
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                  {section.hint && <p className="text-xs text-muted-foreground">{section.hint}</p>}
                  <ul className="divide-y divide-border">
                    {items.map((item) => (
                      <Row key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      )}
    </Dialog>
  );
}

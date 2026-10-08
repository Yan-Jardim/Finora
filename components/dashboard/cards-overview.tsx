import { CreditCard } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatMoney, formatPercent } from "@/lib/format";
import type { CardOverview } from "@/services/dashboard-service";

export function CardsOverview({ cards }: { cards: CardOverview[] }) {
  return (
    <Card>
      <CardHeader title="Cartões" description="Limite e faturas" />
      {cards.length === 0 ? (
        <EmptyState icon={CreditCard} title="Nenhum cartão cadastrado" description="Cadastre um cartão para acompanhar limite e faturas." />
      ) : (
        <ul className="flex flex-col gap-5">
          {cards.map((card) => (
            <li key={card.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-6 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: card.color }} aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{card.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {card.last4 ? `•••• ${card.last4} · ` : ""}vence dia {card.dueDay}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{formatMoney(card.invoiceCents)}</p>
                  <p className="text-xs text-muted-foreground">fatura do mês</p>
                </div>
              </div>
              <ProgressBar value={card.usedPercent} color={card.usedPercent > 80 ? "var(--danger)" : card.color} label={`Limite usado ${card.name}`} />
              <p className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span>
                  Usado {formatMoney(card.usedCents)} ({formatPercent(card.usedPercent)})
                </span>
                <span>Disponível {formatMoney(card.availableCents)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { variation } from "@/domain/report-periods";
import type { BreakdownNode } from "@/domain/reports";
import type { Cents, Transaction } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MeterBar } from "./charts";

/** Variação contra o período anterior. Setas + texto (nunca só cor); período anterior zerado não tem percentual. */
export function Delta({ current, previous, label }: { current: Cents; previous: Cents; label?: string }) {
  const v = variation(current, previous);
  const Icon = v.direction === "up" ? ArrowUpRight : v.direction === "down" ? ArrowDownRight : ArrowRight;
  const text =
    v.percent === null
      ? v.direction === "flat"
        ? "sem variação"
        : `${v.deltaCents > 0 ? "+" : "−"}${formatMoney(Math.abs(v.deltaCents))} (anterior zerado)`
      : `${v.percent > 0 ? "+" : v.percent < 0 ? "−" : ""}${Math.abs(v.percent).toLocaleString("pt-BR")}%`;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground"
      data-testid="delta"
      aria-label={`${label ?? "Variação"} ${v.direction === "up" ? "subiu" : v.direction === "down" ? "caiu" : "não mudou"}: ${text}; período anterior ${formatMoney(previous)}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {text}
      <span className="sr-only"> (anterior {formatMoney(previous)})</span>
      <span aria-hidden> · antes {formatMoney(previous)}</span>
    </span>
  );
}

/** Indicador com a FÓRMULA escrita (nada de nome ambíguo). */
export function Kpi({
  id,
  label,
  value,
  formula,
  tone,
  compare,
  note,
}: {
  id: string;
  label: string;
  value: string;
  /** Como o número é calculado, em linguagem simples. */
  formula: string;
  tone?: "positive" | "negative";
  compare?: { current: Cents; previous: Cents };
  note?: string;
}) {
  return (
    <Card className="flex flex-col gap-1.5" data-testid={`kpi-${id}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <p className={cn("whitespace-nowrap text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", tone === "positive" && "text-success", tone === "negative" && "text-danger")} data-testid={`kpi-${id}-value`}>
        {value}
      </p>
      {compare && <Delta current={compare.current} previous={compare.previous} label={label} />}
      <span className="text-[11px] leading-snug text-muted-foreground">{formula}</span>
      {note && <span className="text-[11px] leading-snug text-muted-foreground">{note}</span>}
    </Card>
  );
}

export function Section({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </Card>
  );
}

export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warning" }) {
  return <p className={cn("rounded-lg px-3 py-2 text-xs", tone === "warning" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>{children}</p>;
}

export interface Drill {
  title: string;
  /** Nó com subcategorias (drill em dois níveis) ou apenas uma lista de movimentações. */
  node?: BreakdownNode;
  transactions: Transaction[];
}

/**
 * DRILL-DOWN: de onde vem o número. Reutiliza as MESMAS movimentações do relatório (sem outra cópia dos dados):
 * categoria → subcategorias → movimentações, com link para a tela de Movimentações.
 */
export function DrillDialog({ drill, onClose, names }: { drill?: Drill; onClose: () => void; names: (tx: Transaction) => string }) {
  return (
    <Dialog open={!!drill} onClose={onClose} title={drill?.title ?? ""} description={drill ? `${drill.transactions.length} ${drill.transactions.length === 1 ? "movimentação" : "movimentações"} · ${formatMoney(drill.transactions.reduce((n, t) => n + t.amountCents, 0))}` : undefined}>
      {drill && <DrillBody key={drill.title} drill={drill} names={names} />}
    </Dialog>
  );
}

function DrillBody({ drill, names }: { drill: Drill; names: (tx: Transaction) => string }) {
  const [childId, setChildId] = useState<string | null>(null);
  const children = drill.node?.children ?? [];
  const child = children.find((c) => c.id === childId);
  const list = child ? child.transactions : drill.transactions;
  return (
    <div className="flex flex-col gap-4" data-testid="drill">
      {children.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Subcategorias">
          {children.map((c) => (
            <li key={`${c.id}-${c.name}`}>
              <button
                type="button"
                onClick={() => setChildId(childId === c.id ? null : c.id)}
                aria-pressed={childId === c.id}
                className={cn("flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted", childId === c.id ? "border-primary" : "border-border")}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{c.name}</span>
                  <span className="tabular-nums" data-testid="drill-child-value">{formatMoney(c.totalCents)}</span>
                </span>
                <MeterBar percent={c.percent} color={c.color} />
                <span className="text-xs text-muted-foreground">{c.percent.toLocaleString("pt-BR")}% · {c.count} {c.count === 1 ? "movimentação" : "movimentações"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{child ? `Movimentações — ${child.name}` : "Movimentações"}</p>
        <ul className="divide-y divide-border" aria-label="Movimentações">
          {list.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate">{t.description}</p>
                <p className="text-xs text-muted-foreground">{formatDate(t.date)} · {names(t)}</p>
              </div>
              <span className="shrink-0 tabular-nums">{formatMoney(t.amountCents)}</span>
            </li>
          ))}
        </ul>
        <Link href="/movimentacoes" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
          Abrir Movimentações
        </Link>
      </div>
    </div>
  );
}

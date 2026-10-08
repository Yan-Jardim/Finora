"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ReceiptText, RotateCcw } from "lucide-react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { movementSign } from "@/domain/pockets";
import type { Pocket, PocketMovement, PocketMovementKind } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { pocketMovementLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

const icons: Record<PocketMovementKind, typeof ArrowUpRight> = {
  reserve: ArrowDownLeft,
  withdraw: ArrowUpRight,
  transfer_in: ArrowLeftRight,
  transfer_out: ArrowLeftRight,
  use: ReceiptText,
  use_reversal: RotateCcw,
};

/**
 * Histórico do cofrinho. A FONTE é `repos.pockets.movements()` (no Supabase vem do banco, sob demanda; nunca de
 * WorkspaceData.pocketMovements). O histórico é imutável: correções aparecem como novos lançamentos (ex.: estorno).
 */
export function PocketHistoryDialog({ pocket, onClose }: { pocket?: Pocket; onClose: () => void }) {
  return (
    <Dialog open={!!pocket} onClose={onClose} title={`Histórico · ${pocket?.name ?? ""}`} description="Reservas, retiradas, transferências, usos em despesas e estornos. O histórico é preservado.">
      {pocket && <History key={pocket.id} pocket={pocket} />}
    </Dialog>
  );
}

function History({ pocket }: { pocket: Pocket }) {
  const { repos, data, loadedWindowKey } = useWorkspace();
  const [state, setState] = useState<{ items?: PocketMovement[]; error?: string }>({});

  // Recarrega quando os dados do workspace mudam (ex.: depois de uma operação).
  useEffect(() => {
    let alive = true;
    repos.pockets
      .movements({ pocketId: pocket.id, limit: 200 })
      .then((items) => alive && setState({ items }))
      .catch(() => alive && setState({ error: "Não foi possível carregar o histórico. Tente novamente." }));
    return () => {
      alive = false;
    };
  }, [repos, pocket.id, data, loadedWindowKey]);

  const transactions = new Map(data.transactions.map((t) => [t.id, t]));

  if (state.error) return <p className="rounded-lg bg-danger-soft px-3 py-3 text-sm text-danger">{state.error}</p>;
  if (!state.items) return <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>;
  if (state.items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum lançamento neste cofrinho ainda.</p>;

  return (
    <ul className="divide-y divide-border" aria-label="Histórico do cofrinho">
      {state.items.map((m) => {
        const Icon = icons[m.kind];
        const positive = movementSign(m.kind) > 0;
        const tx = m.transactionId ? transactions.get(m.transactionId) : undefined;
        return (
          <li key={m.id} className="flex items-start gap-3 py-3">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", positive ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                {pocketMovementLabel[m.kind]}
                {m.kind === "use_reversal" && <Badge tone="neutral">Estorno</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(m.date)}
                {m.note && ` · ${m.note}`}
              </p>
              {m.transactionId && (
                <p className="mt-0.5 text-xs">
                  <Link href="/movimentacoes" className="text-primary hover:underline">
                    Despesa vinculada{tx ? `: ${tx.description}` : ""}
                  </Link>
                </p>
              )}
            </div>
            <span className={cn("shrink-0 text-sm font-semibold tabular-nums", positive ? "text-success" : "text-foreground")}>
              {positive ? "+" : "−"}
              {formatMoney(m.amountCents)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

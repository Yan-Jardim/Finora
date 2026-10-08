"use client";

import { ArrowLeftRight, Ban, CheckCircle2, Clock, CreditCard, Landmark, Pencil, PiggyBank, Repeat, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Menu, type MenuItem } from "@/components/ui/menu";
import type { Category, FinancialProfile, Transaction, TransactionKind, TransactionStatus } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { statusLabel, transactionKindLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** Movimentos que só trocam o dinheiro de lugar (roxo): não são entrada nem despesa. */
const neutralKinds: TransactionKind[] = ["transfer", "card_payment", "investment", "redemption", "debt_payment"];

const statusTone: Record<TransactionStatus, "success" | "warning" | "danger" | "neutral"> = {
  paid: "success",
  pending: "warning",
  overdue: "danger",
  planned: "neutral",
  canceled: "neutral",
};

export interface RowActions {
  onEdit?: () => void;
  onMarkPaid?: () => void;
  onMarkPending?: () => void;
  onCancel?: () => void;
  onReactivate?: () => void;
  /** Ausente nas despesas que usaram cofrinho: elas não se excluem, só se estornam. */
  onDelete?: () => void;
  /** Estornar o uso do cofrinho (despesa ligada a cofrinho, ainda não estornada). */
  onReverse?: () => void;
}

/** Despesa que usou dinheiro de um cofrinho (derivada do histórico do cofrinho). */
export interface PocketUseInfo {
  pocketName: string;
  /** Quanto saiu da reserva (pode ser menos que a despesa). */
  amountCents: number;
  reversed: boolean;
}

export function TransactionRow({
  tx,
  status,
  category,
  profile,
  place,
  debtName,
  pocketUse,
  actions,
}: {
  tx: Transaction;
  status: TransactionStatus;
  category?: Category;
  profile?: FinancialProfile;
  /** "Nubank", "Nubank → Mercado Pago", "Nubank Ultravioleta"… */
  place: string;
  /** Nome da dívida de origem (pagamento de dívida). */
  debtName?: string;
  pocketUse?: PocketUseInfo;
  actions: RowActions;
}) {
  const neutral = neutralKinds.includes(tx.kind);
  const income = tx.kind === "income";
  const canceled = status === "canceled";

  const items: MenuItem[] = [
    actions.onEdit && { label: "Editar", icon: Pencil, onSelect: actions.onEdit },
    actions.onMarkPaid && { label: income ? "Marcar como recebido" : "Marcar como pago", icon: CheckCircle2, onSelect: actions.onMarkPaid },
    actions.onMarkPending && { label: "Marcar como pendente", icon: Clock, onSelect: actions.onMarkPending },
    actions.onCancel && { label: "Cancelar", icon: Ban, onSelect: actions.onCancel },
    actions.onReactivate && { label: "Reativar", icon: RotateCcw, onSelect: actions.onReactivate },
    actions.onReverse && { label: "Estornar", icon: Undo2, onSelect: actions.onReverse },
    actions.onDelete && { label: "Excluir", icon: Trash2, onSelect: actions.onDelete, danger: true },
  ].filter(Boolean) as MenuItem[];

  return (
    <li className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", canceled && "opacity-60")}>
      {tx.kind === "transfer" || tx.kind === "card_payment" ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          {tx.kind === "card_payment" ? <CreditCard className="size-4" aria-hidden /> : <ArrowLeftRight className="size-4" aria-hidden />}
        </span>
      ) : (
        <CategoryIcon name={category?.icon} color={category?.color} />
      )}

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
          <span className={cn("truncate", canceled && "line-through")}>{tx.description}</span>
          {tx.installment && <Badge tone="neutral">Parcela {tx.installment.number}/{tx.installment.total}</Badge>}
          {neutral && <Badge tone="primary">{transactionKindLabel[tx.kind]}</Badge>}
          {tx.debtId && (
            <Badge tone="neutral" title={debtName ? `Dívida: ${debtName}` : "Pagamento de dívida"}>
              <Landmark className="mr-1 size-3" aria-hidden /> Dívida
            </Badge>
          )}
          {pocketUse && (
            <Badge
              tone={pocketUse.reversed ? "neutral" : "primary"}
              title={`Usou ${formatMoney(pocketUse.amountCents)} do cofrinho ${pocketUse.pocketName}${pocketUse.reversed ? " (estornado)" : ""}`}
            >
              <PiggyBank className="mr-1 size-3" aria-hidden /> {pocketUse.reversed ? "Estornada" : `Cofrinho: ${pocketUse.pocketName}`}
            </Badge>
          )}
          {tx.recurringId && (
            <Badge tone="neutral" title="Gerada por uma recorrência">
              <Repeat className="mr-1 size-3" aria-hidden /> Recorrente
            </Badge>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {category && <span>{category.name}</span>}
          {category && <span aria-hidden>•</span>}
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: profile?.color }} aria-hidden />
            {profile?.name ?? "—"}
          </span>
          <span aria-hidden>•</span>
          <span className="inline-flex items-center gap-1">
            {tx.kind === "credit_card_purchase" && <CreditCard className="size-3" aria-hidden />}
            {place}
          </span>
          <span aria-hidden>•</span>
          <span>{formatDate(tx.date)}</span>
        </p>
        {tx.tags.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1">
            {tx.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                #{tag}
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            income && "text-success",
            neutral && "text-primary",
            !income && !neutral && "text-danger",
            canceled && "line-through",
          )}
        >
          {income ? "+" : tx.kind === "transfer" ? "" : "−"}
          {formatMoney(tx.amountCents)}
        </span>
        <Badge tone={statusTone[status]}>{statusLabel(tx.kind, status)}</Badge>
      </div>

      <Menu label={`Ações de ${tx.description}`} items={items} />
    </li>
  );
}

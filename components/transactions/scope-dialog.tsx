"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { InstallmentScope } from "@/domain/installments";
import type { Transaction } from "@/domain/types";
import type { ScopePreview } from "@/services/transaction-commands";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pergunta o alcance de uma edição/exclusão em compra parcelada e mostra o impacto antes de confirmar. */
export function ScopeDialog({
  tx,
  mode,
  onClose,
  onConfirm,
}: {
  tx?: Transaction;
  mode: "edit" | "delete";
  onClose: () => void;
  onConfirm: (scope: InstallmentScope) => void | Promise<void>;
}) {
  return (
    <Dialog
      open={!!tx}
      onClose={onClose}
      title={mode === "edit" ? "Editar compra parcelada" : "Excluir compra parcelada"}
      description={tx?.installment ? `${tx.description} — parcela ${tx.installment.number}/${tx.installment.total}` : undefined}
    >
      {tx && <ScopeBody tx={tx} mode={mode} onClose={onClose} onConfirm={onConfirm} />}
    </Dialog>
  );
}

function ScopeBody({
  tx,
  mode,
  onClose,
  onConfirm,
}: {
  tx: Transaction;
  mode: "edit" | "delete";
  onClose: () => void;
  onConfirm: (scope: InstallmentScope) => void | Promise<void>;
}) {
  const { commands } = useWorkspace();
  const [scope, setScope] = useState<InstallmentScope>("this");
  const [busy, setBusy] = useState(false);
  const verb = mode === "edit" ? "alteradas" : "excluídas";

  const options: { id: InstallmentScope; label: string }[] =
    mode === "edit"
      ? [
          { id: "this", label: "Somente esta parcela" },
          { id: "future", label: "Esta e as próximas" },
        ]
      : [
          { id: "this", label: "Somente esta parcela" },
          { id: "future", label: "Esta e as próximas parcelas" },
          { id: "all", label: "Compra inteira" },
        ];

  // O impacto vem do motor de comandos (no Supabase considera TODAS as parcelas da compra, não só as carregadas).
  const [plan, setPlan] = useState<ScopePreview | null>(null);
  useEffect(() => {
    let cancelled = false;
    commands
      .previewScope(tx, scope)
      .then((next) => !cancelled && setPlan(next))
      .catch(() => !cancelled && setPlan(null));
    return () => {
      cancelled = true;
    };
  }, [commands, tx, scope]);

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" className="flex flex-col gap-2">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
          >
            <input type="radio" name="scope" className="accent-[var(--primary)]" checked={scope === option.id} onChange={() => setScope(option.id)} />
            {option.label}
          </label>
        ))}
      </div>

      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        {plan ? (
          <>
            {plural(plan.affected, "parcela será", "parcelas serão")} {verb}.
            {plan.keptPaid > 0 &&
              ` ${plural(plan.keptPaid, "parcela já paga será mantida", "parcelas já pagas serão mantidas")} (fatura quitada).`}
          </>
        ) : (
          "Calculando o impacto…"
        )}
        {mode === "edit" && scope === "future" && " Valor e data de cada parcela não mudam."}
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant={mode === "delete" ? "danger" : "primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm(scope);
            setBusy(false);
          }}
        >
          {mode === "edit" ? "Continuar" : "Excluir"}
        </Button>
      </div>
    </div>
  );
}

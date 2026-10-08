"use client";

import { useState } from "react";
import { Field, FormFooter, Select } from "@/components/forms/fields";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import type { Goal } from "@/domain/types";
import { formatMoney } from "@/lib/format";
import { snapshotOf, snapshotPocketBalance } from "@/domain/snapshot";

/** Texto EXATO exigido antes de vincular (o valor manual é substituído e não volta ao desvincular). */
export const LINK_WARNING =
  "O progresso informado manualmente será substituído pelo valor realmente reservado neste cofrinho. O valor manual anterior não será restaurado automaticamente se você desvincular depois.";

/** Vincular / trocar / desvincular o cofrinho de um objetivo. Usa `linkGoal` (a unicidade e o zeramento do manual ficam no banco). */
export function GoalLinkDialog({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  return (
    <Dialog
      open={!!goal}
      onClose={onClose}
      title={goal?.pocketId ? "Cofrinho do objetivo" : "Vincular cofrinho"}
      description="Com um cofrinho vinculado, o progresso do objetivo é o dinheiro realmente reservado nele."
    >
      {goal && <LinkForm key={goal.id} goal={goal} onClose={onClose} />}
    </Dialog>
  );
}

function LinkForm({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { data, pocketCommands, today } = useWorkspace();
  const run = useAction();
  const [pocketId, setPocketId] = useState(goal.pocketId ?? "");
  const [busy, setBusy] = useState(false);
  const snap = snapshotOf(data, today);

  // Cofrinhos ativos que ainda não estão ligados a OUTRO objetivo (o atual continua disponível).
  const taken = new Set(data.goals.filter((g) => g.pocketId && g.id !== goal.id).map((g) => g.pocketId));
  const options = data.pockets.filter((p) => (p.status === "active" && !taken.has(p.id)) || p.id === goal.pocketId);
  const changed = pocketId !== (goal.pocketId ?? "");
  const linking = pocketId !== "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!changed) return onClose();
    setBusy(true);
    const ok = await run(
      () => pocketCommands.linkGoal(goal.id, pocketId || null),
      pocketId ? "Cofrinho vinculado ao objetivo." : "Cofrinho desvinculado do objetivo.",
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Cofrinho" hint={options.length === 0 ? "Crie um cofrinho em Cofrinhos para vincular." : undefined}>
        {(p) => (
          <Select {...p} value={pocketId} onChange={(e) => setPocketId(e.target.value)}>
            <option value="">Nenhum (progresso manual)</option>
            {options.map((p2) => (
              <option key={p2.id} value={p2.id}>
                {p2.name} · {formatMoney(snapshotPocketBalance(snap, p2))}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {changed && linking && (
        <p role="note" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {LINK_WARNING}
        </p>
      )}
      {changed && !linking && (
        <p role="note" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          O objetivo volta a ser manual e começa em {formatMoney(0)}: o valor manual anterior não é restaurado. Informe o progresso manual editando o objetivo.
        </p>
      )}

      <FormFooter onCancel={onClose} submitting={busy} submitLabel={linking ? "Vincular cofrinho" : changed ? "Desvincular" : "Fechar"} />
    </form>
  );
}

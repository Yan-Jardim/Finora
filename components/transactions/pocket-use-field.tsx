"use client";

import { Field, Input, Select } from "@/components/forms/fields";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { snapshotOf, snapshotPocketBalance } from "@/domain/snapshot";
import type { Cents, ID } from "@/domain/types";
import { formatMoney } from "@/lib/format";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { accountPosition } from "@/services/pocket-view";

export interface PocketUseValue {
  enabled: boolean;
  pocketId: ID;
  /** Quanto da reserva usar (texto do campo). */
  amount: string;
}

export const NO_POCKET_USE: PocketUseValue = { enabled: false, pocketId: "", amount: "" };

/**
 * "Usar dinheiro de um cofrinho" na criação de uma DESPESA PAGA em conta. Só aparece quando a conta tem reserva. O envio usa
 * exclusivamente `pocketCommands.spend` (RPC spend_from_pocket): nada de operação em vários passos no frontend.
 */
export function PocketUseField({
  accountId,
  expenseCents,
  value,
  onChange,
}: {
  accountId: ID;
  /** Valor da despesa digitado (null = inválido). */
  expenseCents: Cents | null;
  value: PocketUseValue;
  onChange: (next: PocketUseValue) => void;
}) {
  const { data, today } = useWorkspace();
  const snap = snapshotOf(data, today);
  const options = data.pockets
    .filter((p) => p.status === "active" && p.accountId === accountId)
    .map((p) => ({ pocket: p, balance: snapshotPocketBalance(snap, p) }))
    .filter((o) => o.balance > 0);

  if (options.length === 0) return null;

  const selected = options.find((o) => o.pocket.id === value.pocketId);
  const position = accountPosition(data, today, accountId);
  const typed = parseMoneyToCents(value.amount);
  const expense = expenseCents ?? 0;
  const cap = selected ? Math.min(expense, selected.balance) : 0;
  const fromPocket = selected && typed !== null && typed > 0 ? Math.min(typed, cap) : null;

  // Sugestão: usar o máximo possível da reserva (o usuário ajusta para um uso parcial).
  const suggestion = (balance: Cents) => (expense > 0 ? centsToInput(Math.min(expense, balance)) : "");

  const toggle = (enabled: boolean) => {
    if (!enabled) return onChange({ ...value, enabled });
    const option = options.find((o) => o.pocket.id === value.pocketId) ?? options[0];
    onChange({ enabled, pocketId: option.pocket.id, amount: suggestion(option.balance) });
  };

  const pick = (pocketId: ID) => {
    const option = options.find((o) => o.pocket.id === pocketId);
    onChange({ ...value, pocketId, amount: option ? suggestion(option.balance) : "" });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-3" data-testid="pocket-use">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={value.enabled} onChange={(e) => toggle(e.target.checked)} />
        <span className="text-sm">
          <span className="font-medium">Usar dinheiro de um cofrinho</span>
          <span className="block text-xs text-muted-foreground">
            A despesa sai inteira do saldo da conta e a parte escolhida sai da reserva — sem contar duas vezes no dinheiro livre.
          </span>
        </span>
      </label>

      {value.enabled && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cofrinho">
              {(p) => (
                <Select {...p} value={value.pocketId} onChange={(e) => pick(e.target.value)}>
                  {options.map((o) => (
                    <option key={o.pocket.id} value={o.pocket.id}>
                      {o.pocket.name} · {formatMoney(o.balance)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Valor da reserva a utilizar" hint="Pode ser parcial.">
              {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />}
            </Field>
          </div>

          {selected && expenseCents !== null && expenseCents > 0 && fromPocket !== null && (
            <dl className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-xs" aria-label="Resumo do uso da reserva">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Saldo da conta cai</dt>
                <dd className="tabular-nums">{formatMoney(expense)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Cofrinho cai</dt>
                <dd className="tabular-nums">{formatMoney(fromPocket)}</dd>
              </div>
              <div className="flex justify-between gap-3 font-medium">
                <dt>Dinheiro livre cai apenas</dt>
                <dd className="tabular-nums">{formatMoney(expense - fromPocket)}</dd>
              </div>
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>Livre da conta</dt>
                <dd className="tabular-nums">
                  {formatMoney(position.freeCents)} → {formatMoney(position.freeCents - (expense - fromPocket))}
                </dd>
              </div>
            </dl>
          )}
          {selected && typed !== null && expense > 0 && typed > cap && (
            <p role="alert" className="text-xs text-danger">
              O valor da reserva não pode passar de {formatMoney(cap)} (o menor entre a despesa e o saldo do cofrinho).
            </p>
          )}
        </>
      )}
    </div>
  );
}

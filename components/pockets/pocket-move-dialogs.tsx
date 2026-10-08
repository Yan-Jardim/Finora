"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import { snapshotOf, snapshotPocketBalance } from "@/domain/snapshot";
import type { ID } from "@/domain/types";
import { formatMoney } from "@/lib/format";
import { parseMoneyToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  pocketMoveSchema,
  pocketTransferSchema,
  type PocketMoveFormValues,
  type PocketTransferFormValues,
} from "@/schemas/pocket";
import { accountPosition } from "@/services/pocket-view";

export type PocketMoveMode = "reserve" | "withdraw";

/** Linha "rótulo ......... valor" do resumo antes de confirmar. */
function Line({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-semibold", danger && "text-danger")}>{value}</dd>
    </div>
  );
}

const NOT_BANK_NOTE = "Isto não é uma despesa, receita nem transferência bancária: o saldo da conta não muda.";

// ---------------------------------------------------------------------------------------------------------------------
// Reservar / retirar
// ---------------------------------------------------------------------------------------------------------------------

export function PocketMoveDialog({ mode, pocketId, onClose }: { mode: PocketMoveMode; pocketId?: ID; onClose: () => void }) {
  const open = !!pocketId;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "reserve" ? "Reservar dinheiro" : "Retirar reserva"}
      description={
        mode === "reserve"
          ? "Separe uma parte do dinheiro livre da conta neste cofrinho."
          : "Devolva dinheiro do cofrinho para o saldo livre da conta."
      }
    >
      {pocketId && <MoveForm key={`${mode}-${pocketId}`} mode={mode} pocketId={pocketId} onClose={onClose} />}
    </Dialog>
  );
}

function MoveForm({ mode, pocketId, onClose }: { mode: PocketMoveMode; pocketId: ID; onClose: () => void }) {
  const { data, pocketCommands, today } = useWorkspace();
  const run = useAction();
  const pockets = data.pockets.filter((p) => p.status === "active" || p.id === pocketId);
  const snap = snapshotOf(data, today);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PocketMoveFormValues>({
    resolver: zodResolver(pocketMoveSchema),
    defaultValues: { pocketId, amount: "", date: today, note: "" },
  });
  const [selectedId, amountText, dateText] = useWatch({ control, name: ["pocketId", "amount", "date"] });

  const pocket = data.pockets.find((p) => p.id === selectedId);
  const position = pocket ? accountPosition(data, today, pocket.accountId) : undefined;
  const balance = pocket ? snapshotPocketBalance(snap, pocket) : 0;
  const cents = parseMoneyToCents(amountText);
  const valid = cents !== null && cents > 0;

  const onSubmit = handleSubmit(async (values) => {
    const input = { pocketId: values.pocketId, amountCents: parseMoneyToCents(values.amount) ?? 0, date: values.date, note: values.note.trim() || undefined };
    const ok = await run(
      () => (mode === "reserve" ? pocketCommands.reserve(input) : pocketCommands.withdraw(input)),
      mode === "reserve" ? "Dinheiro reservado." : "Reserva retirada.",
    );
    if (ok) onClose();
  });

  // Avisos antes de enviar (o banco/motor local continuam sendo a palavra final).
  const overFree = mode === "reserve" && valid && position !== undefined && cents > position.freeCents;
  const overBalance = mode === "withdraw" && valid && cents > balance;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Cofrinho" error={errors.pocketId?.message}>
        {(p) => (
          <Select {...p} {...register("pocketId")}>
            {pockets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={mode === "reserve" ? "Valor a reservar" : "Valor a retirar"} error={errors.amount?.message}>
          {(p) => <Input {...p} autoFocus inputMode="decimal" placeholder="0,00" {...register("amount")} />}
        </Field>
        <Field label="Data" error={errors.date?.message}>
          {(p) => <Input {...p} type="date" max={today} {...register("date")} />}
        </Field>
      </div>

      <Field label="Observação" optional error={errors.note?.message}>
        {(p) => <Input {...p} placeholder="Ex.: sobra do mês" {...register("note")} />}
      </Field>

      {pocket && position && (
        <dl className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/50 p-3 text-sm" aria-label="Resumo da operação">
          {mode === "reserve" ? (
            <>
              <Line label="Saldo da conta" value={formatMoney(position.balanceCents)} />
              <Line label="Reservado" value={formatMoney(position.reservedCents)} />
              <Line label="Livre atual" value={formatMoney(position.freeCents)} />
              <Line label="Quanto será reservado" value={valid ? formatMoney(cents) : "—"} />
              <div className="mt-1 border-t border-border pt-2">
                <Line
                  label="Livre depois da reserva"
                  value={valid ? formatMoney(position.freeCents - cents) : "—"}
                  strong
                  danger={overFree}
                />
              </div>
            </>
          ) : (
            <>
              <Line label="Reservado atual (neste cofrinho)" value={formatMoney(balance)} />
              <Line label="Valor a retirar" value={valid ? formatMoney(cents) : "—"} />
              <Line label="Reservado restante" value={valid ? formatMoney(balance - cents) : "—"} danger={overBalance} />
              <div className="mt-1 border-t border-border pt-2">
                <Line label="Livre da conta depois da retirada" value={valid ? formatMoney(position.freeCents + cents) : "—"} strong />
              </div>
            </>
          )}
        </dl>
      )}
      {overFree && position && (
        <p role="alert" className="text-xs text-danger">
          Só há {formatMoney(position.freeCents)} livres nesta conta: faltam {formatMoney(cents - position.freeCents)}.
        </p>
      )}
      {overBalance && (
        <p role="alert" className="text-xs text-danger">
          O cofrinho tem só {formatMoney(balance)}: faltam {formatMoney(cents - balance)}.
        </p>
      )}
      {dateText > today && (
        <p role="alert" className="text-xs text-danger">
          A data não pode ser futura.
        </p>
      )}
      <p className="text-xs text-muted-foreground">{NOT_BANK_NOTE}</p>

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel={mode === "reserve" ? "Reservar" : "Retirar"} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Transferir entre cofrinhos (mesma conta)
// ---------------------------------------------------------------------------------------------------------------------

export function PocketTransferDialog({ fromPocketId, onClose }: { fromPocketId?: ID; onClose: () => void }) {
  return (
    <Dialog
      open={!!fromPocketId}
      onClose={onClose}
      title="Transferir entre cofrinhos"
      description="Mova reserva de um cofrinho para outro da mesma conta. O saldo bancário e o total reservado não mudam."
    >
      {fromPocketId && <TransferForm key={fromPocketId} fromPocketId={fromPocketId} onClose={onClose} />}
    </Dialog>
  );
}

function TransferForm({ fromPocketId, onClose }: { fromPocketId: ID; onClose: () => void }) {
  const { data, pocketCommands, today } = useWorkspace();
  const run = useAction();
  const active = data.pockets.filter((p) => p.status === "active");
  const snap = snapshotOf(data, today);

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PocketTransferFormValues>({
    resolver: zodResolver(pocketTransferSchema),
    defaultValues: { fromPocketId, toPocketId: "", amount: "", date: today, note: "" },
  });
  const [fromId, toId, amountText] = useWatch({ control, name: ["fromPocketId", "toPocketId", "amount"] });

  const from = data.pockets.find((p) => p.id === fromId);
  const to = data.pockets.find((p) => p.id === toId);
  // Só cofrinhos da MESMA conta e diferentes da origem.
  const targets = active.filter((p) => p.accountId === from?.accountId && p.id !== fromId);
  const fromBalance = from ? snapshotPocketBalance(snap, from) : 0;
  const toBalance = to ? snapshotPocketBalance(snap, to) : 0;
  const cents = parseMoneyToCents(amountText);
  const valid = cents !== null && cents > 0;
  const accountName = data.accounts.find((a) => a.id === from?.accountId)?.name;

  const onSubmit = handleSubmit(async (values) => {
    const ok = await run(
      () =>
        pocketCommands.transfer({
          fromPocketId: values.fromPocketId,
          toPocketId: values.toPocketId,
          amountCents: parseMoneyToCents(values.amount) ?? 0,
          date: values.date,
          note: values.note.trim() || undefined,
        }),
      "Reserva transferida.",
    );
    if (ok) onClose();
  });

  if (active.filter((p) => p.accountId === from?.accountId).length < 2) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">
          Para transferir você precisa de pelo menos dois cofrinhos ativos na mesma conta{accountName ? ` (${accountName})` : ""}.
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Origem" error={errors.fromPocketId?.message}>
          {(p) => (
            <Select {...p} {...register("fromPocketId", { onChange: () => setValue("toPocketId", "") })}>
              {active
                .filter((item) => item.accountId === from?.accountId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Destino" error={errors.toPocketId?.message} hint={accountName ? `Só cofrinhos de ${accountName}.` : undefined}>
          {(p) => (
            <Select {...p} {...register("toPocketId")}>
              <option value="">Selecione…</option>
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Valor" error={errors.amount?.message}>
          {(p) => <Input {...p} autoFocus inputMode="decimal" placeholder="0,00" {...register("amount")} />}
        </Field>
        <Field label="Data" error={errors.date?.message}>
          {(p) => <Input {...p} type="date" max={today} {...register("date")} />}
        </Field>
      </div>

      <Field label="Observação" optional error={errors.note?.message}>
        {(p) => <Input {...p} {...register("note")} />}
      </Field>

      <dl className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/50 p-3 text-sm" aria-label="Resumo da transferência">
        <Line label="Origem" value={from ? `${from.name} · ${formatMoney(fromBalance)}${valid ? ` → ${formatMoney(fromBalance - cents)}` : ""}` : "—"} />
        <Line label="Destino" value={to ? `${to.name} · ${formatMoney(toBalance)}${valid ? ` → ${formatMoney(toBalance + cents)}` : ""}` : "—"} />
        <Line label="Valor" value={valid ? formatMoney(cents) : "—"} strong />
      </dl>
      {valid && cents > fromBalance && (
        <p role="alert" className="text-xs text-danger">
          O cofrinho de origem tem só {formatMoney(fromBalance)}: faltam {formatMoney(cents - fromBalance)}.
        </p>
      )}
      <p className="text-xs text-muted-foreground">O saldo bancário e o total reservado da conta não mudam.</p>

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel="Transferir" />
    </form>
  );
}

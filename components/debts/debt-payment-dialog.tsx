"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import type { DebtSummary } from "@/domain/debts";
import type { Debt } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { debtPaymentSchema, type DebtPaymentFormValues } from "@/schemas/debt";

export type DebtPaymentMode = "pay" | "settle";

/**
 * Pagar parcela / registrar pagamento (parcial ou livre) e Quitar dívida. O valor sai da conta ESCOLHIDA e vira uma
 * transação de pagamento; a dívida só atualiza o progresso (derivado). Nada acima do saldo devido.
 */
export function DebtPaymentDialog({
  debt,
  summary,
  mode,
  onClose,
}: {
  debt?: Debt;
  summary?: DebtSummary;
  mode: DebtPaymentMode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!debt}
      onClose={onClose}
      title={mode === "pay" ? "Pagar parcela" : "Quitar dívida"}
      description={
        mode === "pay"
          ? "O valor sai da conta escolhida e vira um pagamento. Pode ser parcial ou adiantado."
          : "Informe o valor efetivamente pago e a dívida será encerrada. A diferença para o saldo projetado fica registrada."
      }
    >
      {debt && summary && <PaymentForm debt={debt} summary={summary} mode={mode} onClose={onClose} />}
    </Dialog>
  );
}

function PaymentForm({ debt, summary, mode, onClose }: { debt: Debt; summary: DebtSummary; mode: DebtPaymentMode; onClose: () => void }) {
  const { data, debtCommands, today } = useWorkspace();
  const run = useAction();

  // Conta de pagamento: a da dívida é só sugestão; nunca conta de investimento.
  const accounts = data.accounts.filter((a) => (a.active && a.type !== "investment") || a.id === debt.paymentAccountId);
  const remaining = summary.remainingCents;
  const suggested = mode === "pay" ? Math.min(summary.nextOpenCents ?? remaining, remaining) : remaining;

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DebtPaymentFormValues>({
    resolver: zodResolver(debtPaymentSchema),
    defaultValues: { accountId: debt.paymentAccountId ?? accounts[0]?.id ?? "", amount: centsToInput(suggested), date: today },
  });
  const amountText = useWatch({ control, name: "amount" });
  const typed = parseMoneyToCents(amountText);

  const onSubmit = handleSubmit(async (values) => {
    const cents = parseMoneyToCents(values.amount);
    if (cents === null || (mode === "pay" ? cents <= 0 : cents < 0)) {
      return setError("amount", { message: mode === "pay" ? "Informe um valor maior que zero." : "Informe um valor válido." });
    }
    if (cents > remaining) return setError("amount", { message: "O pagamento não pode ser maior que o saldo devido." });

    const input = { debtId: debt.id, accountId: values.accountId, amountCents: cents, date: values.date };
    const ok = await run(
      () => (mode === "pay" ? debtCommands.pay(input) : debtCommands.settle(input)),
      mode === "pay" ? "Pagamento registrado." : "Dívida quitada.",
    );
    if (ok) onClose();
  });

  if (remaining <= 0) {
    return <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">Esta dívida não tem saldo devido.</p>;
  }
  if (accounts.length === 0) {
    return <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">Cadastre uma conta em Contas antes de registrar pagamentos.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <strong className="text-foreground">{debt.name}</strong> · saldo devido {formatMoney(remaining)}
        {mode === "pay" && summary.nextDueDate && ` · próxima: ${formatDate(summary.nextDueDate)} — ${formatMoney(summary.nextOpenCents ?? 0)}`}
      </p>

      <Field label="Pagar com a conta" error={errors.accountId?.message}>
        {(p) => (
          <Select {...p} {...register("accountId")}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={mode === "pay" ? "Valor pago" : "Valor efetivamente pago"}
          error={errors.amount?.message}
          hint={mode === "pay" ? "Pode ser parcial ou adiantado." : undefined}
        >
          {(p) => <Input {...p} inputMode="decimal" {...register("amount")} />}
        </Field>
        <Field label="Data do pagamento" error={errors.date?.message}>
          {(p) => <Input {...p} type="date" {...register("date")} />}
        </Field>
      </div>

      {mode === "settle" && typed !== null && typed >= 0 && typed <= remaining && (
        <p className="text-xs text-muted-foreground">
          Saldo projetado {formatMoney(remaining)} · você paga {formatMoney(typed)} · desconto{" "}
          <strong className="text-foreground">{formatMoney(remaining - typed)}</strong>.
        </p>
      )}

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel={mode === "pay" ? "Registrar pagamento" : "Quitar dívida"} />
    </form>
  );
}

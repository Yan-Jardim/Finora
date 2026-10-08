"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import { invoicePaymentError } from "@/domain/rules";
import { snapshotCardInvoices, snapshotOf } from "@/domain/snapshot";
import type { CreditCard } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { invoicePaymentSchema, type InvoicePaymentFormValues } from "@/schemas/invoice-payment";

export function PayInvoiceDialog({
  card,
  initialMonth,
  onClose,
}: {
  card?: CreditCard;
  /** Fatura pré-selecionada ("YYYY-MM"). */
  initialMonth?: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!card}
      onClose={onClose}
      title="Pagar fatura"
      description="O valor sai da conta e reduz a fatura. Não é uma nova despesa: o gasto já foi contado nas compras."
    >
      {card && <PayInvoiceForm card={card} initialMonth={initialMonth} onClose={onClose} />}
    </Dialog>
  );
}

function PayInvoiceForm({ card, initialMonth, onClose }: { card: CreditCard; initialMonth?: string; onClose: () => void }) {
  const { data, commands, today } = useWorkspace();
  const run = useAction();

  // Faturas em aberto: views do banco (supabase) ou derivadas (local). O pagamento em si é do banco/motor.
  const payable = snapshotCardInvoices(snapshotOf(data, today), card.id).filter((i) => i.openCents > 0);
  const first = payable.find((i) => i.dueMonth === initialMonth) ?? payable[0];
  // Conta de pagamento: a do cartão é só SUGESTÃO (padrão); a conta usada é a escolhida aqui. Nunca conta de investimento.
  const accounts = data.accounts.filter((a) => (a.active && a.type !== "investment") || a.id === card.accountId);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InvoicePaymentFormValues>({
    resolver: zodResolver(invoicePaymentSchema),
    defaultValues: {
      invoiceMonth: first?.dueMonth ?? "",
      accountId: card.accountId ?? accounts[0]?.id ?? "",
      amount: first ? centsToInput(first.openCents) : "",
      date: today,
    },
  });
  const selectedMonth = useWatch({ control, name: "invoiceMonth" });

  if (payable.length === 0) {
    return <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">Este cartão não possui faturas em aberto.</p>;
  }

  const onSubmit = handleSubmit(async (values) => {
    const invoice = payable.find((i) => i.dueMonth === values.invoiceMonth);
    const amountCents = parseMoneyToCents(values.amount) ?? 0;
    const error = invoicePaymentError(invoice, amountCents);
    if (error) return setError("amount", { message: error });

    const ok = await run(
      () => commands.payInvoice({ cardId: card.id, dueMonth: values.invoiceMonth, accountId: values.accountId, amountCents, date: values.date }),
      "Pagamento da fatura registrado.",
    );
    if (ok) onClose();
  });

  const selected = payable.find((i) => i.dueMonth === selectedMonth);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Fatura" error={errors.invoiceMonth?.message} hint={selected ? `Total ${formatMoney(selected.totalCents)} · pago ${formatMoney(selected.paidCents)}` : undefined}>
        {(p) => (
          <Select
            {...p}
            {...register("invoiceMonth", {
              onChange: (e) => {
                const invoice = payable.find((i) => i.dueMonth === e.target.value);
                if (invoice) setValue("amount", centsToInput(invoice.openCents));
              },
            })}
          >
            {payable.map((invoice) => (
              <option key={invoice.dueMonth} value={invoice.dueMonth}>
                Vence {formatDate(invoice.dueDate)} — {formatMoney(invoice.openCents)} em aberto
              </option>
            ))}
          </Select>
        )}
      </Field>

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
        <Field label="Valor pago" error={errors.amount?.message} hint="Pode ser parcial.">
          {(p) => <Input {...p} inputMode="decimal" {...register("amount")} />}
        </Field>
        <Field label="Data do pagamento" error={errors.date?.message}>
          {(p) => <Input {...p} type="date" {...register("date")} />}
        </Field>
      </div>

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel="Registrar pagamento" />
    </form>
  );
}

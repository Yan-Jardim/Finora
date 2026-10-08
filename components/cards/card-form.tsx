"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { ColorPicker, Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import { duplicateCardName } from "@/domain/rules";
import type { CreditCard } from "@/domain/types";
import { cardBrandLabel } from "@/lib/labels";
import {
  cardBrands,
  cardFromForm,
  cardToForm,
  creditCardDefaults,
  creditCardSchema,
  type CreditCardFormValues,
} from "@/schemas/credit-card";

export function CardFormDialog({
  open,
  onClose,
  card,
}: {
  open: boolean;
  onClose: () => void;
  card?: CreditCard;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={card ? "Editar cartão" : "Novo cartão"} description="Cadastre limite, fechamento e vencimento para acompanhar suas faturas.">
      <CardForm card={card} onClose={onClose} />
    </Dialog>
  );
}

function CardForm({ card, onClose }: { card?: CreditCard; onClose: () => void }) {
  const { data, repos } = useWorkspace();
  const run = useAction();

  const owners = data.profiles.filter((p) => p.active || p.id === card?.ownerProfileId);
  // Fatura é paga por conta (não por conta de investimento).
  const payAccounts = data.accounts.filter(
    (a) => (a.active && a.type !== "investment") || a.id === card?.accountId,
  );

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreditCardFormValues>({
    resolver: zodResolver(creditCardSchema),
    defaultValues: card
      ? cardToForm(card)
      : { ...creditCardDefaults, ownerProfileId: owners[0]?.id ?? "", accountId: payAccounts[0]?.id ?? "" },
  });

  if (owners.length === 0) {
    return (
      <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">
        Para cadastrar um cartão você precisa de pelo menos uma pessoa ativa. Cadastre em <strong>Pessoas</strong>.
      </p>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    const duplicate = duplicateCardName(values.name, data.creditCards, card?.id);
    if (duplicate) return setError("name", { message: duplicate });

    const input = cardFromForm(values);
    const ok = await run(
      () => (card ? repos.creditCards.update(card.id, input) : repos.creditCards.create({ ...input, active: true })),
      card ? "Cartão atualizado." : "Cartão criado.",
    );
    if (ok) onClose();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Nome do cartão" error={errors.name?.message}>
        {(p) => <Input {...p} placeholder="Ex.: Nubank Ultravioleta" autoFocus {...register("name")} />}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Proprietário" error={errors.ownerProfileId?.message}>
          {(p) => (
            <Select {...p} {...register("ownerProfileId")}>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Conta padrão para pagar a fatura" optional error={errors.accountId?.message} hint="Apenas uma sugestão: no pagamento você escolhe a conta.">
          {(p) => (
            <Select {...p} {...register("accountId")}>
              <option value="">Nenhuma</option>
              {payAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Bandeira" optional error={errors.brand?.message}>
          {(p) => (
            <Select {...p} {...register("brand")}>
              <option value="">Não informar</option>
              {cardBrands.map((b) => (
                <option key={b} value={b}>
                  {cardBrandLabel[b]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Limite" error={errors.limit?.message}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="5.000,00" {...register("limit")} />}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Dia de fechamento" error={errors.closingDay?.message}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={2} placeholder="Ex.: 3" {...register("closingDay")} />}
        </Field>
        <Field label="Dia de vencimento" error={errors.dueDay?.message}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={2} placeholder="Ex.: 10" {...register("dueDay")} />}
        </Field>
      </div>

      <Field label="Últimos 4 dígitos" optional error={errors.last4?.message}>
        {(p) => <Input {...p} inputMode="numeric" maxLength={4} placeholder="0000" {...register("last4")} />}
      </Field>

      <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Por segurança, nunca pedimos o número completo do cartão nem o CVV.
      </p>

      <Field label="Cor" error={errors.color?.message}>
        {() => <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />}
      </Field>

      <FormFooter onCancel={onClose} submitting={isSubmitting} />
    </form>
  );
}

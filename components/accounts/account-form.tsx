"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Checkbox, ColorPicker, Field, FormFooter, IconPicker, Input, Select } from "@/components/forms/fields";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Dialog } from "@/components/ui/dialog";
import { duplicateAccountName } from "@/domain/rules";
import type { Account } from "@/domain/types";
import { accountTypeLabel } from "@/lib/labels";
import {
  accountDefaults,
  accountFromForm,
  accountSchema,
  accountToForm,
  accountTypes,
  type AccountFormValues,
} from "@/schemas/account";

export function AccountFormDialog({
  open,
  onClose,
  account,
}: {
  open: boolean;
  onClose: () => void;
  account?: Account;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={account ? "Editar conta" : "Nova conta"}
      description="Contas, carteiras, dinheiro em espécie ou investimentos — dê o nome que quiser."
    >
      <AccountForm account={account} onClose={onClose} />
    </Dialog>
  );
}

function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { data, repos } = useWorkspace();
  const run = useAction();

  // Só perfis ativos para novos cadastros (mantém o dono atual ao editar).
  const owners = data.profiles.filter((p) => p.active || p.id === account?.ownerProfileId);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: account ? accountToForm(account) : { ...accountDefaults, ownerProfileId: owners[0]?.id ?? "" },
  });
  const color = useWatch({ control, name: "color" });

  if (owners.length === 0) {
    return (
      <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">
        Cadastre pelo menos uma pessoa ativa em <strong>Pessoas</strong> antes de criar uma conta.
      </p>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    const duplicate = duplicateAccountName(values.name, data.accounts, account?.id);
    if (duplicate) return setError("name", { message: duplicate });

    const input = accountFromForm(values);
    const ok = await run(
      () => (account ? repos.accounts.update(account.id, input) : repos.accounts.create({ ...input, active: true })),
      account ? "Conta atualizada." : "Conta criada.",
    );
    if (ok) onClose();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Nome da conta" error={errors.name?.message}>
        {(p) => <Input {...p} placeholder="Ex.: Nubank Principal" autoFocus {...register("name")} />}
      </Field>

      <Field label="Instituição" optional error={errors.institution?.message}>
        {(p) => <Input {...p} placeholder="Ex.: Nubank, Itaú, XP…" {...register("institution")} />}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Proprietário" error={errors.ownerProfileId?.message}>
          {(p) => (
            <Select {...p} {...register("ownerProfileId")}>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tipo" error={errors.type?.message}>
          {(p) => (
            <Select {...p} {...register("type")}>
              {accountTypes.map((type) => (
                <option key={type} value={type}>
                  {accountTypeLabel[type]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field label="Saldo inicial" error={errors.initialBalance?.message} hint="O saldo atual é calculado a partir deste valor + movimentações.">
        {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("initialBalance")} />}
      </Field>

      <Field label="Cor" error={errors.color?.message}>
        {() => <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />}
      </Field>

      <Field label="Ícone" error={errors.icon?.message}>
        {() => (
          <Controller
            control={control}
            name="icon"
            render={({ field }) => (
              <div className="flex flex-col gap-3">
                <IconPicker value={field.value} onChange={field.onChange} color={color} />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CategoryIcon name={field.value} color={color} /> Pré-visualização
                </div>
              </div>
            )}
          />
        )}
      </Field>

      <Checkbox
        label="Incluir no patrimônio"
        description="Contas desmarcadas não entram nos saldos nem no patrimônio."
        {...register("includeInNetWorth")}
      />

      <FormFooter onCancel={onClose} submitting={isSubmitting} />
    </form>
  );
}

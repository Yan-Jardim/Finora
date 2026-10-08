"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { ColorPicker, Field, FormFooter, IconPicker, Input, Select } from "@/components/forms/fields";
import { useAction, useCurrentProfile, useWorkspace } from "@/components/providers/workspace-provider";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Dialog } from "@/components/ui/dialog";
import type { Pocket } from "@/domain/types";
import { formatMoney } from "@/lib/format";
import { parseMoneyToCents } from "@/lib/money";
import { pocketDefaults, pocketSchema, pocketToForm, type PocketFormValues } from "@/schemas/pocket";
import { accountPosition } from "@/services/pocket-view";

export function PocketFormDialog({ open, onClose, pocket }: { open: boolean; onClose: () => void; pocket?: Pocket }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={pocket ? "Editar cofrinho" : "Novo cofrinho"}
      description="Um cofrinho separa uma parte do saldo de uma conta para um propósito. O dinheiro continua na conta: nada é gasto nem transferido."
    >
      <PocketForm pocket={pocket} onClose={onClose} />
    </Dialog>
  );
}

function PocketForm({ pocket, onClose }: { pocket?: Pocket; onClose: () => void }) {
  const { data, pocketCommands, today } = useWorkspace();
  const currentProfile = useCurrentProfile();
  const run = useAction();
  const editing = !!pocket;

  const profiles = data.profiles.filter((p) => p.active || p.id === pocket?.profileId);
  // Só contas de consumo ativas (investimento não tem cofrinho). Ao editar a conta fica fixa.
  const accounts = data.accounts.filter((a) => (a.active && a.type !== "investment") || a.id === pocket?.accountId);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PocketFormValues>({
    resolver: zodResolver(pocketSchema),
    defaultValues: pocket ? pocketToForm(pocket) : pocketDefaults(currentProfile?.id ?? profiles[0]?.id ?? "", accounts[0]?.id ?? ""),
  });
  const [color, accountId, initialText] = useWatch({ control, name: ["color", "accountId", "initial"] });

  const position = accountId ? accountPosition(data, today, accountId) : undefined;
  const initial = parseMoneyToCents(initialText);

  const onSubmit = handleSubmit(async (values) => {
    if (pocket) {
      const ok = await run(
        () =>
          pocketCommands.update(pocket.id, {
            name: values.name.trim(),
            description: values.description.trim() || undefined,
            icon: values.icon,
            color: values.color,
            profileId: values.profileId,
          }),
        "Cofrinho atualizado.",
      );
      if (ok) onClose();
      return;
    }
    const ok = await run(
      () =>
        pocketCommands.create({
          name: values.name.trim(),
          description: values.description.trim() || undefined,
          icon: values.icon,
          color: values.color,
          profileId: values.profileId,
          accountId: values.accountId,
          initialCents: parseMoneyToCents(values.initial) ?? 0,
          date: today,
        }),
      "Cofrinho criado.",
    );
    if (ok) onClose();
  });

  if (profiles.length === 0 || accounts.length === 0) {
    return (
      <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">
        {profiles.length === 0
          ? "Cadastre uma pessoa em Pessoas antes de criar cofrinhos."
          : "Cadastre uma conta de consumo (corrente, digital, poupança, carteira…) em Contas antes de criar cofrinhos."}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Nome" error={errors.name?.message}>
        {(p) => <Input {...p} autoFocus placeholder="Ex.: Reserva de emergência" {...register("name")} />}
      </Field>

      <Field label="Descrição" optional error={errors.description?.message}>
        {(p) => <Input {...p} placeholder="Para que serve este dinheiro?" {...register("description")} />}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Responsável" error={errors.profileId?.message}>
          {(p) => (
            <Select {...p} {...register("profileId")}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Conta vinculada"
          error={errors.accountId?.message}
          hint={editing ? "A conta não pode ser trocada depois de criado." : "O dinheiro fica nesta conta. Não dá para trocar depois."}
        >
          {(p) =>
            editing ? (
              // Conta fixa depois de criado: texto (um campo desabilitado sairia do formulário).
              <p id={p.id} aria-describedby={p["aria-describedby"]} className="flex h-10 items-center rounded-lg border border-border bg-muted px-3 text-sm">
                {accounts.find((a) => a.id === pocket?.accountId)?.name ?? "—"}
              </p>
            ) : (
              <Select {...p} {...register("accountId")}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>
      </div>

      {!editing && (
        <Field label="Reserva inicial" optional error={errors.initial?.message} hint="Quanto separar agora, do dinheiro livre da conta.">
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("initial")} />}
        </Field>
      )}
      {!editing && position && (
        <p className="-mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Livre na conta agora: <strong className="text-foreground">{formatMoney(position.freeCents)}</strong>
          {initial !== null && initial > 0 && (
            <>
              {" "}
              · depois: <strong className="text-foreground">{formatMoney(position.freeCents - initial)}</strong>
            </>
          )}
        </p>
      )}

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

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel={editing ? "Salvar alterações" : "Criar cofrinho"} />
    </form>
  );
}

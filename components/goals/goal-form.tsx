"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { ColorPicker, Field, FormFooter, IconPicker, Input, Select } from "@/components/forms/fields";
import { useAction, useCurrentProfile, useWorkspace } from "@/components/providers/workspace-provider";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Dialog } from "@/components/ui/dialog";
import type { Goal } from "@/domain/types";
import { goalKindLabel, goalStatusLabel } from "@/lib/labels";
import { goalDefaults, goalFromForm, goalKinds, goalSchema, goalStatuses, goalToForm, type GoalFormValues } from "@/schemas/pocket";

export function GoalFormDialog({ open, onClose, goal }: { open: boolean; onClose: () => void; goal?: Goal }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={goal ? "Editar objetivo" : "Novo objetivo"}
      description="Uma meta com valor e prazo. Para acompanhar dinheiro de verdade, vincule um cofrinho depois de criar."
    >
      <GoalForm goal={goal} onClose={onClose} />
    </Dialog>
  );
}

function GoalForm({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { data, repos } = useWorkspace();
  const currentProfile = useCurrentProfile();
  const run = useAction();
  const linked = !!goal?.pocketId;
  const profiles = data.profiles.filter((p) => p.active || p.id === goal?.profileId);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<GoalFormValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: goal ? goalToForm(goal) : goalDefaults(currentProfile?.id ?? profiles[0]?.id ?? ""),
  });
  const color = useWatch({ control, name: "color" });

  const onSubmit = handleSubmit(async (values) => {
    const input = goalFromForm(values);
    if (goal) {
      // Ligado a um cofrinho o progresso é o saldo real: o valor manual não é enviado (o banco o mantém em 0).
      const { manualAmountCents, ...rest } = input;
      const patch = linked ? rest : { ...rest, manualAmountCents };
      const ok = await run(() => repos.goals.update(goal.id, patch), "Objetivo atualizado.");
      if (ok) onClose();
      return;
    }
    const ok = await run(() => repos.goals.create({ ...input, pocketId: undefined }), "Objetivo criado.");
    if (ok) onClose();
  });

  if (profiles.length === 0) {
    return <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">Cadastre uma pessoa em Pessoas antes de criar objetivos.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Nome" error={errors.name?.message}>
        {(p) => <Input {...p} autoFocus placeholder="Ex.: Viagem para a Europa" {...register("name")} />}
      </Field>

      <Field label="Descrição" optional error={errors.description?.message}>
        {(p) => <Input {...p} {...register("description")} />}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tipo" error={errors.kind?.message}>
          {(p) => (
            <Select {...p} {...register("kind")}>
              {goalKinds.map((k) => (
                <option key={k} value={k}>
                  {goalKindLabel[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Valor da meta" error={errors.target?.message}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("target")} />}
        </Field>
        <Field label="Prazo" optional error={errors.deadline?.message}>
          {(p) => <Input {...p} type="date" {...register("deadline")} />}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Situação" error={errors.status?.message}>
          {(p) => (
            <Select {...p} {...register("status")}>
              {goalStatuses.map((s) => (
                <option key={s} value={s}>
                  {goalStatusLabel[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {linked ? (
          <Field label="Progresso" hint="Este objetivo está vinculado a um cofrinho: o progresso é o valor realmente reservado nele.">
            {(p) => (
              <p id={p.id} aria-describedby={p["aria-describedby"]} className="flex h-10 items-center rounded-lg border border-border bg-muted px-3 text-sm">
                Reservado em cofrinho
              </p>
            )}
          </Field>
        ) : (
          <Field label="Progresso informado manualmente" optional error={errors.manual?.message} hint="Não é dinheiro reservado: não entra no reservado, no disponível nem no patrimônio.">
            {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("manual")} />}
          </Field>
        )}
      </div>

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

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel={goal ? "Salvar alterações" : "Criar objetivo"} />
    </form>
  );
}

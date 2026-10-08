"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { ColorPicker, Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import { duplicateProfileName } from "@/domain/rules";
import type { FinancialProfile } from "@/domain/types";
import {
  profileDefaults,
  profileFromForm,
  profileSchema,
  profileToForm,
  type ProfileFormValues,
} from "@/schemas/profile";

export function ProfileFormDialog({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile?: FinancialProfile;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={profile ? "Editar pessoa" : "Nova pessoa"}
      description="Pessoas e o casal são perfis financeiros. Cada conta, cartão e movimentação pertence a um perfil."
    >
      <ProfileForm profile={profile} onClose={onClose} />
    </Dialog>
  );
}

function ProfileForm({ profile, onClose }: { profile?: FinancialProfile; onClose: () => void }) {
  const { data, repos } = useWorkspace();
  const run = useAction();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: profile ? profileToForm(profile) : profileDefaults,
  });

  const name = useWatch({ control, name: "name" });
  const color = useWatch({ control, name: "color" });

  const onSubmit = handleSubmit(async (values) => {
    const duplicate = duplicateProfileName(values.name, data.profiles, profile?.id);
    if (duplicate) return setError("name", { message: duplicate });

    const input = profileFromForm(values);
    const ok = await run(
      () => (profile ? repos.profiles.update(profile.id, input) : repos.profiles.create({ ...input, active: true })),
      profile ? "Pessoa atualizada." : "Pessoa criada.",
    );
    if (ok) onClose();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
        <span
          className="flex size-11 items-center justify-center rounded-full text-lg font-semibold text-white"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <p className="text-sm text-muted-foreground">O avatar usa a inicial do nome e a cor escolhida.</p>
      </div>

      <Field label="Nome" error={errors.name?.message}>
        {(p) => <Input {...p} placeholder="Ex.: Ana, Casal" autoFocus {...register("name")} />}
      </Field>

      <Field label="Tipo" error={errors.kind?.message} hint="Compartilhado serve para o casal ou despesas em conjunto.">
        {(p) => (
          <Select {...p} {...register("kind")}>
            <option value="individual">Individual</option>
            <option value="shared">Compartilhado</option>
          </Select>
        )}
      </Field>

      <Field label="Cor" error={errors.color?.message}>
        {() => <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />}
      </Field>

      <FormFooter onCancel={onClose} submitting={isSubmitting} />
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { Checkbox, Field, Input } from "@/components/forms/fields";
import { bootstrapHouseholdAction } from "@/lib/auth/actions";
import type { FormState } from "@/schemas/auth";
import { FormMessage, SubmitButton } from "./submit-button";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState<FormState, FormData>(bootstrapHouseholdAction, {});
  const [share, setShare] = useState(state.values ? state.values.shareWithPartner === "on" : true);

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <FormMessage error={state.error} />

      <Field label="Seu nome" error={state.fieldErrors?.displayName} hint="Será o seu perfil financeiro.">
        {(p) => <Input {...p} name="displayName" defaultValue={state.values?.displayName ?? defaultName} autoFocus />}
      </Field>

      <Field label="Nome do espaço" error={state.fieldErrors?.householdName} hint="Ex.: Casa da Ana e do Bruno, Minhas finanças.">
        {(p) => <Input {...p} name="householdName" defaultValue={state.values?.householdName} />}
      </Field>

      <Checkbox
        name="shareWithPartner"
        checked={share}
        onChange={(e) => setShare(e.target.checked)}
        label="Vou compartilhar com meu/minha parceiro(a)"
        description="Cria também o perfil do casal. O convite do parceiro virá em uma próxima etapa."
      />

      {share && (
        <Field label="Nome do perfil do casal" error={state.fieldErrors?.coupleName}>
          {(p) => <Input {...p} name="coupleName" defaultValue={state.values?.coupleName ?? "Casal"} />}
        </Field>
      )}

      <SubmitButton pendingLabel="Criando…">Começar</SubmitButton>
    </form>
  );
}

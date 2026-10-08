"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/forms/fields";
import { signupAction } from "@/lib/auth/actions";
import type { FormState } from "@/schemas/auth";
import { FormMessage, SubmitButton } from "./submit-button";

export function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signupAction, {});

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <FormMessage error={state.error} message={state.message} />

      <Field label="Seu nome" error={state.fieldErrors?.displayName}>
        {(p) => <Input {...p} name="displayName" autoComplete="name" defaultValue={state.values?.displayName} autoFocus />}
      </Field>
      <Field label="E-mail" error={state.fieldErrors?.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />}
      </Field>
      <Field label="Senha" error={state.fieldErrors?.password} hint="Mínimo de 8 caracteres.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" />}
      </Field>
      <Field label="Confirmar senha" error={state.fieldErrors?.confirmPassword}>
        {(p) => <Input {...p} name="confirmPassword" type="password" autoComplete="new-password" />}
      </Field>

      <SubmitButton pendingLabel="Criando conta…">Criar conta</SubmitButton>
    </form>
  );
}

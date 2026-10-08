"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/forms/fields";
import { loginAction } from "@/lib/auth/actions";
import type { FormState } from "@/schemas/auth";
import { FormMessage, SubmitButton } from "./submit-button";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormMessage error={state.error ?? notice} />

      <Field label="E-mail" error={state.fieldErrors?.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" defaultValue={state.values?.email} autoFocus />}
      </Field>
      <Field label="Senha" error={state.fieldErrors?.password}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" />}
      </Field>

      <SubmitButton pendingLabel="Entrando…">Entrar</SubmitButton>
    </form>
  );
}

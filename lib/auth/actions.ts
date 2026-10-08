"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, onboardingSchema, signupSchema, type FormState } from "@/schemas/auth";
import { safeNextPath } from "./paths";

/** Server Actions de autenticação. Rodam só no servidor; o navegador nunca vê credenciais além do formulário. */

const fieldErrors = (error: ZodError): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
};

const text = (data: FormData, key: string) => String(data.get(key) ?? "");

/** Origem pública da requisição (para o link de confirmação de e-mail). */
async function requestOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
}

function authErrorMessage(error: { code?: string; message: string; status?: number }): string {
  switch (error.code) {
    case "invalid_credentials":
      return "E-mail ou senha incorretos.";
    case "email_not_confirmed":
      return "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Muitas tentativas. Aguarde um pouco e tente novamente.";
    case "weak_password":
      return "Senha muito fraca. Use uma senha mais forte.";
    case "user_already_exists":
    case "email_exists":
      return "Já existe uma conta com este e-mail. Tente entrar.";
    default:
      return error.status === 429 ? "Muitas tentativas. Aguarde um pouco e tente novamente." : "Não foi possível concluir. Tente novamente.";
  }
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: text(formData, "email"), password: text(formData, "password") });
  const values = { email: text(formData, "email") };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authErrorMessage(error), values };

  redirect(safeNextPath(text(formData, "next")));
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    displayName: text(formData, "displayName"),
    email: text(formData, "email"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  const values = { displayName: text(formData, "displayName"), email: text(formData, "email") };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${await requestOrigin()}/auth/callback`,
    },
  });
  if (error) return { error: authErrorMessage(error), values };

  // Com "Confirm email" desligado, a sessão já vem pronta e o usuário segue para o onboarding.
  if (data.session) redirect("/onboarding");

  return {
    message: `Enviamos um link de confirmação para ${parsed.data.email}. Abra o e-mail para ativar sua conta e depois entre.`,
  };
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const onboardingErrors: Record<string, string> = {
  already_onboarded: "Você já possui um espaço financeiro.",
  invalid_household_name: "Nome do espaço inválido.",
  invalid_display_name: "Nome inválido.",
  invalid_couple_name: "Nome do perfil do casal inválido.",
  not_authenticated: "Sua sessão expirou. Entre novamente.",
};

/** Cria o household (via função segura bootstrap_household) e segue para o app. */
export async function bootstrapHouseholdAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = onboardingSchema.safeParse({
    householdName: text(formData, "householdName"),
    displayName: text(formData, "displayName"),
    shareWithPartner: formData.get("shareWithPartner") === "on",
    coupleName: text(formData, "coupleName"),
  });
  const values = {
    householdName: text(formData, "householdName"),
    displayName: text(formData, "displayName"),
    coupleName: text(formData, "coupleName"),
    shareWithPartner: formData.get("shareWithPartner") === "on" ? "on" : "",
  };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("bootstrap_household", {
    p_household_name: parsed.data.householdName,
    p_display_name: parsed.data.displayName,
    p_create_couple_profile: parsed.data.shareWithPartner,
    p_couple_profile_name: parsed.data.coupleName || "Casal",
  });

  if (error) {
    // Quem já tem household apenas segue para o app.
    if (error.message.includes("already_onboarded")) redirect("/");
    const code = Object.keys(onboardingErrors).find((key) => error.message.includes(key));
    return { error: code ? onboardingErrors[code] : "Não foi possível criar seu espaço. Tente novamente.", values };
  }

  redirect("/");
}

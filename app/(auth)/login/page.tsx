import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth/paths";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = typeof next === "string" ? safeNextPath(next, "") : "";
  const notice = error === "confirmation" ? "Não foi possível confirmar seu e-mail. Tente entrar ou peça um novo link." : undefined;

  return (
    <AuthShell
      title="Entrar"
      description="Acesse suas finanças."
    >
      <LoginForm next={nextPath || undefined} notice={notice} />
    </AuthShell>
  );
}

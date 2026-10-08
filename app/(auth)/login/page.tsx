import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth/paths";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = typeof next === "string" ? safeNextPath(next, "") : "";
  const notice = error === "confirmation" ? "Não foi possível confirmar seu e-mail. Tente entrar ou crie a conta novamente." : undefined;

  return (
    <AuthShell
      title="Entrar"
      description="Acesse suas finanças."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="font-medium text-primary hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <LoginForm next={nextPath || undefined} notice={notice} />
    </AuthShell>
  );
}

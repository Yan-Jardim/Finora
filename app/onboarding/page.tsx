import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Bem-vindo" };

export default async function OnboardingPage() {
  const { supabase, userId, email } = await requireUser();

  // Quem já tem household não precisa de onboarding.
  const { data: membership } = await supabase.from("household_members").select("household_id").limit(1).maybeSingle();
  if (membership) redirect("/");

  const { data: profile } = await supabase.from("user_profiles").select("display_name").eq("id", userId).maybeSingle();

  return (
    <AuthShell title="Vamos começar" description={`Conta criada para ${email}. Configure seu espaço financeiro.`}>
      <OnboardingForm defaultName={profile?.display_name ?? ""} />
    </AuthShell>
  );
}

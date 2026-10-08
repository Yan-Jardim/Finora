import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Sessão e household do usuário, lidos no servidor.
 * Identidade vem de getClaims (JWT verificado), nunca de getSession; o household vem do banco via RLS.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  return { supabase, userId: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
}

/** Household do usuário (RLS filtra: só aparecem os dele). Sem household -> onboarding. */
export async function requireHousehold() {
  const { supabase, userId, email } = await requireUser();

  const [{ data: membership }, { data: profile }, { data: ownProfile }] = await Promise.all([
    supabase.from("household_members").select("household_id, role, households(name, timezone)").limit(1).maybeSingle(),
    supabase.from("user_profiles").select("display_name").eq("id", userId).maybeSingle(),
    // Perfil financeiro individual vinculado a este login (nem todo perfil tem login).
    supabase.from("financial_profiles").select("id").eq("user_id", userId).limit(1).maybeSingle(),
  ]);
  if (!membership) redirect("/onboarding");

  return {
    userId,
    email,
    displayName: profile?.display_name || email.split("@")[0] || "Você",
    householdId: membership.household_id,
    householdName: membership.households?.name ?? "",
    /** Fuso do household: fonte de "hoje" no app (o banco usa o mesmo). */
    householdTimezone: membership.households?.timezone ?? "America/Sao_Paulo",
    currentProfileId: ownProfile?.id,
    role: membership.role,
  };
}

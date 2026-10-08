/**
 * Variáveis públicas do Supabase. A chave "publishable" é segura para o navegador (o acesso
 * é limitado pelo RLS). A service_role NUNCA é lida pelo app.
 */
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY em .env.local (veja .env.example).",
    );
  }
  return { url, publishableKey };
}

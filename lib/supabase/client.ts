import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { resilientFetch } from "./resilient-fetch";

/**
 * Cliente para Client Components (navegador). Usa só a chave publishable;
 * o que ele pode ler/gravar é decidido pelo RLS no banco.
 */
export function createClient() {
  // Acesso estático: o Next só embute NEXT_PUBLIC_* quando referenciadas literalmente.
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    // Repete só LEITURAS (e o login) diante de 502/503/504 ou queda de conexão; escritas nunca são repetidas.
    { global: { fetch: resilientFetch() } },
  );
}

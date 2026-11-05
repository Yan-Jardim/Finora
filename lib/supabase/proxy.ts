import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, safeNextPath } from "@/lib/auth/paths";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

/**
 * Roda a cada requisição (via proxy.ts):
 *  1. renova o token de sessão (getClaims valida o JWT; nada de confiar em getSession);
 *  2. protege as rotas: sem sessão -> /login; com sessão em /login -> /.
 * A checagem de "tem household?" fica nos layouts (precisa do banco).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Não colocar código entre createServerClient e getClaims: quebra a renovação da sessão.
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;

  const { pathname, search } = request.nextUrl;
  const redirectTo = (path: string, params?: Record<string, string>) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = "";
    Object.entries(params ?? {}).forEach(([key, value]) => target.searchParams.set(key, value));
    const redirect = NextResponse.redirect(target);
    // Mantém os cookies de sessão renovados no redirecionamento.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!signedIn && !isPublicPath(pathname)) {
    return redirectTo("/login", pathname === "/" ? undefined : { next: safeNextPath(pathname + search) });
  }
  if (signedIn && pathname === "/login") {
    return redirectTo("/");
  }
  return response;
}

/** Rotas acessíveis sem sessão. Todo o resto exige login. */
const PUBLIC_PREFIXES = ["/login", "/cadastro", "/auth"];

export const isPublicPath = (pathname: string) =>
  PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));

/**
 * Evita open redirect: só aceita caminhos internos ("/algo"), nunca "//host" ou URLs absolutas.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}

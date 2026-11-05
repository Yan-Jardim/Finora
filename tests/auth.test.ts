import { describe, expect, it } from "vitest";
import { isPublicPath, safeNextPath } from "@/lib/auth/paths";
import { loginSchema, onboardingSchema } from "@/schemas/auth";

describe("rotas públicas", () => {
  it("login e callback são públicos; o resto (inclusive o antigo /cadastro) exige sessão", () => {
    for (const path of ["/login", "/auth/callback"]) expect(isPublicPath(path)).toBe(true);
    for (const path of ["/", "/cadastro", "/contas", "/movimentacoes", "/onboarding", "/login-falso", "/authx"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe("safeNextPath (anti open redirect)", () => {
  it("aceita só caminhos internos", () => {
    expect(safeNextPath("/contas?x=1")).toBe("/contas?x=1");
    expect(safeNextPath("/")).toBe("/");
  });
  it("recusa URLs externas e variações", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNextPath(bad as string)).toBe("/");
    }
    expect(safeNextPath("//evil.com", "/home")).toBe("/home");
  });
});

describe("schemas de autenticação", () => {
  it("login: e-mail e senha obrigatórios; e-mail normalizado", () => {
    expect(loginSchema.safeParse({ email: "", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "nao-e-email", password: "x" }).success).toBe(false);
    const ok = loginSchema.safeParse({ email: "  Ana@Exemplo.COM ", password: "x" });
    expect(ok.success && ok.data.email).toBe("ana@exemplo.com");
  });

  it("onboarding: perfil do casal só é exigido quando compartilhado, e não pode repetir o nome", () => {
    const base = { householdName: "Casa", displayName: "Ana", shareWithPartner: true, coupleName: "Casal" };
    expect(onboardingSchema.safeParse(base).success).toBe(true);
    expect(onboardingSchema.safeParse({ ...base, coupleName: "" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, coupleName: "ana" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, shareWithPartner: false, coupleName: "" }).success).toBe(true);
    expect(onboardingSchema.safeParse({ ...base, householdName: "  " }).success).toBe(false);
  });
});

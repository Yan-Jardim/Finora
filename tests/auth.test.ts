import { describe, expect, it } from "vitest";
import { isPublicPath, safeNextPath } from "@/lib/auth/paths";
import { loginSchema, onboardingSchema, signupSchema } from "@/schemas/auth";

describe("rotas públicas", () => {
  it("login, cadastro e callback são públicos; o resto exige sessão", () => {
    for (const path of ["/login", "/cadastro", "/auth/callback"]) expect(isPublicPath(path)).toBe(true);
    for (const path of ["/", "/contas", "/movimentacoes", "/onboarding", "/login-falso", "/authx"]) {
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

  it("cadastro: senha mínima de 8 e confirmação igual", () => {
    const base = { displayName: "Ana", email: "ana@exemplo.com", password: "12345678", confirmPassword: "12345678" };
    expect(signupSchema.safeParse(base).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, password: "1234567", confirmPassword: "1234567" }).success).toBe(false);
    const mismatch = signupSchema.safeParse({ ...base, confirmPassword: "outra-senha" });
    expect(mismatch.success).toBe(false);
    expect(!mismatch.success && mismatch.error.issues[0].path[0]).toBe("confirmPassword");
    expect(signupSchema.safeParse({ ...base, displayName: " " }).success).toBe(false);
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

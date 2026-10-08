import { describe, expect, it } from "vitest";
import { cardFromForm, creditCardDefaults, creditCardSchema } from "@/schemas/credit-card";

const valid = { ...creditCardDefaults, name: "Nubank", ownerProfileId: "p1", limit: "5.000,00", closingDay: "3", dueDay: "10" };

describe("formulário de cartão: conta padrão de pagamento", () => {
  it("é opcional (vazio é válido)", () => {
    expect(creditCardSchema.safeParse({ ...valid, accountId: "" }).success).toBe(true);
    expect(creditCardSchema.safeParse({ ...valid, accountId: "a1" }).success).toBe(true);
  });
  it("vazio vira ausente no domínio", () => {
    expect(cardFromForm({ ...valid, accountId: "" }).accountId).toBeUndefined();
    expect(cardFromForm({ ...valid, accountId: "a1" }).accountId).toBe("a1");
  });
  it("continua recusando limite zero, dia inválido e last4 inválido", () => {
    expect(creditCardSchema.safeParse({ ...valid, limit: "0" }).success).toBe(false);
    expect(creditCardSchema.safeParse({ ...valid, closingDay: "32" }).success).toBe(false);
    expect(creditCardSchema.safeParse({ ...valid, last4: "12ab" }).success).toBe(false);
  });
});

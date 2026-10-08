import { describe, expect, it, vi } from "vitest";
import { AppError, appError, friendlyDbMessage, toFriendlyError } from "@/repositories/supabase/errors";

const GENERIC = "Não foi possível concluir a operação. Tente novamente.";

const STATIC_CODES = [
  "pocket_not_found", "goal_not_found", "pocket_has_balance", "pocket_archived", "pocket_account_immutable", "account_has_reserve",
  "account_not_allowed", "different_accounts", "same_pocket", "use_pocket_flow", "amount_from_pocket_invalid", "no_pocket_use",
  "already_reversed", "pocket_already_linked", "category_required", "future_date", "use_invalid_expense", "reversal_invalid",
  "use_inconsistent", "transfer_unbalanced", "pocket_history_immutable",
];

describe("tradução centralizada dos erros de cofrinhos", () => {
  it.each(STATIC_CODES)("%s tem mensagem amigável e não vaza o código técnico", (code) => {
    const msg = friendlyDbMessage({ message: code, code: "P0001" });
    expect(msg).not.toBe(GENERIC);
    expect(msg).not.toContain(code);
  });

  it("mensagens dinâmicas usam os valores do DETAIL (dinheiro formatado)", () => {
    expect(friendlyDbMessage({ message: "reserve_shortfall", details: "shortfall_cents=1500;reserved_cents=100;balance_cents=50" })).toContain("R$ 15,00");
    expect(friendlyDbMessage({ message: "insufficient_free", details: "shortfall_cents=1;free_cents=70000" })).toBe("Saldo livre insuficiente na conta: você pediu R$ 700,01, mas só há R$ 700,00 livres (faltam R$ 0,01).");
    expect(friendlyDbMessage({ message: "insufficient_pocket", details: "shortfall_cents=250;balance_cents=1000" })).toBe("O cofrinho tem só R$ 10,00: faltam R$ 2,50.");
  });

  it("sem DETAIL, as mensagens dinâmicas caem num texto genérico (sem 'undefined' nem NaN)", () => {
    for (const code of ["reserve_shortfall", "insufficient_free", "insufficient_pocket"]) {
      const msg = friendlyDbMessage({ message: code });
      expect(msg).not.toMatch(/undefined|NaN/);
      expect(msg.length).toBeGreaterThan(10);
    }
  });

  it("toFriendlyError devolve AppError com código estável e os valores parseados", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = toFriendlyError({ code: "P0001", message: "reserve_shortfall", details: "account_id=a1;shortfall_cents=500" });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("reserve_shortfall");
    expect(e.info).toMatchObject({ account_id: "a1", shortfall_cents: "500" });
    expect(e.cause).toBeDefined();
  });

  it("erro desconhecido: mensagem genérica e sem código", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = toFriendlyError({ message: "boom" });
    expect(e.message).toBe(GENERIC);
    expect(e.code).toBeUndefined();
  });

  it("código casa por palavra inteira (same_pocket não confunde com outros)", () => {
    expect(toFriendlyError({ message: "ERROR: same_pocket" }).code).toBe("same_pocket");
    expect(toFriendlyError({ message: "pocket_archived: x" }).code).toBe("pocket_archived");
  });

  it("motor local: appError(code, info) = MESMA mensagem e código que o banco devolveria", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cases: [string, Record<string, number | string>][] = [
      ["reserve_shortfall", { shortfall_cents: 1500 }],
      ["insufficient_free", { shortfall_cents: 1, free_cents: 70000 }],
      ["insufficient_pocket", { shortfall_cents: 250, balance_cents: 1000 }],
      ...STATIC_CODES.map((c): [string, Record<string, number | string>] => [c, {}]),
    ];
    for (const [code, info] of cases) {
      const details = Object.entries(info).map(([k, v]) => `${k}=${v}`).join(";");
      const db = toFriendlyError({ message: code, details });
      const local = appError(code, info);
      expect([local.code, local.message]).toEqual([db.code, db.message]);
    }
  });

  it("restrições de tabela têm texto próprio", () => {
    expect(friendlyDbMessage({ code: "23514", message: 'violates check constraint "pockets_name_check"' })).not.toBe(friendlyDbMessage({ code: "23514", message: "x" }));
    expect(friendlyDbMessage({ code: "23514", message: 'violates check constraint "goals_manual_xor_pocket"' })).not.toBe(friendlyDbMessage({ code: "23514", message: "x" }));
  });
});

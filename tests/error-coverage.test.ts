/**
 * AUDITORIA DE ERROS: todo `raise exception '<codigo>'` das migrations precisa ter tradução amigável em
 * repositories/supabase/errors.ts — nenhuma mensagem crua do Postgres pode chegar ao usuário. O teste lê as migrations
 * (fonte da verdade do que o banco pode levantar) e falha se surgir um código novo sem mapeamento.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appError, friendlyDbMessage, toFriendlyError } from "@/repositories/supabase/errors";

const dir = path.resolve(import.meta.dirname, "..", "supabase", "migrations");
const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
const raised = [...new Set([...sql.matchAll(/raise exception +'([^']*)'/gi)].map((m) => m[1]))];
const GENERIC = "Não foi possível concluir a operação. Tente novamente.";

/** Códigos que nunca chegam à tela como erro de operação: o app não os dispara pela interface (validação prévia no formulário/servidor). */
const HANDLED_BY_FORMS = new Set<string>([
  "invalid_household_name", // onboarding valida o nome antes (schemas/auth)
  "invalid_display_name",
  "invalid_couple_name",
  "already_onboarded", // o servidor redireciona para o app
]);

describe("toda exceção do banco tem mensagem amigável", () => {
  it("encontrou as exceções das migrations", () => {
    expect(raised.length).toBeGreaterThan(60);
  });

  const codes = raised.filter((c) => /^[a-z_]+$/.test(c));
  it.each(codes.filter((c) => !HANDLED_BY_FORMS.has(c)))("%s → texto traduzido (não genérico, sem o código técnico)", (code) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = friendlyDbMessage({ message: code, code: "P0001" });
    expect(message, `código sem tradução: ${code}`).not.toBe(GENERIC);
    expect(message).not.toContain(code);
    expect(toFriendlyError({ message: code, code: "P0001" }).code).toBe(code);
  });

  it("mensagens em texto livre (não são códigos) nunca vazam: viram o texto genérico", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const text of raised.filter((c) => !/^[a-z_]+$/.test(c))) {
      expect(friendlyDbMessage({ message: text, code: "P0001" })).not.toContain(text);
    }
  });

  it("SQLSTATE e mensagens cruas do Postgres/PostgREST nunca aparecem", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = [
      { code: "23505", message: 'duplicate key value violates unique constraint "accounts_pkey"' },
      { code: "23503", message: 'insert or update on table "transactions" violates foreign key constraint "x"' },
      { code: "23514", message: 'new row for relation "transactions" violates check constraint "transactions_amount_check"' },
      { code: "42501", message: "permission denied for table transactions" },
      { code: "42P01", message: 'relation "x" does not exist' },
      { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      { code: "22P02", message: 'invalid input syntax for type uuid: "abc"' },
      { code: "57014", message: "canceling statement due to statement timeout" },
      { message: "TypeError: Failed to fetch" },
      { message: "FetchError: network timeout at: https://x.supabase.co" },
    ];
    for (const error of raw) {
      const m = friendlyDbMessage(error);
      expect(m, JSON.stringify(error)).not.toMatch(/violates|duplicate key|PGRST|SQLSTATE|relation|permission denied|syntax for type|statement timeout|TypeError|FetchError|[0-9]{5}/);
      expect(m.length).toBeGreaterThan(10);
    }
  });

  it("o motor local devolve a MESMA mensagem do banco para os códigos que ele reproduz", () => {
    for (const code of ["reserve_shortfall", "insufficient_free", "insufficient_pocket", "use_pocket_flow", "pocket_archived"]) {
      expect(appError(code, { shortfall_cents: 100, free_cents: 50, balance_cents: 10 }).message).toBe(
        friendlyDbMessage({ message: code, details: "shortfall_cents=100;free_cents=50;balance_cents=10" }),
      );
    }
  });
});

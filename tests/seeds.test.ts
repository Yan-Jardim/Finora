/**
 * DADOS DE DEMONSTRAÇÃO (mocks/data.ts) precisam respeitar TODAS as regras que o banco impõe: nada do modo demonstração pode
 * representar um estado que o Supabase recusaria. Aqui replicamos as restrições do schema (formato por tipo, status x
 * pago, chaves estrangeiras, parcelas, faturas, dívidas, cofrinhos, objetivos, recorrências) sobre os seeds.
 */
import { describe, expect, it } from "vitest";
import { accountBalance, sum } from "@/domain/calculations";
import { deriveSnapshot } from "@/domain/snapshot";
import { seeds } from "@/mocks/data";

const t = seeds.transactions;
const accounts = new Map(seeds.accounts.map((a) => [a.id, a]));
const cards = new Map(seeds.creditCards.map((c) => [c.id, c]));
const categories = new Map(seeds.categories.map((c) => [c.id, c]));
const profiles = new Map(seeds.profiles.map((p) => [p.id, p]));
const TODAY = "2026-10-07";

describe("seeds de demonstração × regras do banco", () => {
  it("ids únicos e referências existentes (perfil, conta, cartão, categoria, dívida, recorrência, compra parcelada)", () => {
    for (const list of [t, seeds.accounts, seeds.creditCards, seeds.categories, seeds.profiles, seeds.pockets, seeds.pocketMovements, seeds.goals, seeds.debts]) {
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    }
    const purchases = new Set(seeds.installmentPurchases.map((p) => p.id));
    const rules = new Set(seeds.recurringTransactions.map((r) => r.id));
    const debts = new Set(seeds.debts.map((d) => d.id));
    for (const x of t) {
      expect(profiles.has(x.profileId), `${x.id}: perfil`).toBe(true);
      if (x.accountId) expect(accounts.has(x.accountId), `${x.id}: conta`).toBe(true);
      if (x.toAccountId) expect(accounts.has(x.toAccountId), `${x.id}: conta destino`).toBe(true);
      if (x.cardId) expect(cards.has(x.cardId), `${x.id}: cartão`).toBe(true);
      if (x.categoryId) expect(categories.has(x.categoryId), `${x.id}: categoria`).toBe(true);
      if (x.debtId) expect(debts.has(x.debtId), `${x.id}: dívida`).toBe(true);
      if (x.recurringId) expect(rules.has(x.recurringId), `${x.id}: recorrência inexistente (FK recusaria)`).toBe(true);
      if (x.installment) expect(purchases.has(x.installment.purchaseId), `${x.id}: compra parcelada`).toBe(true);
    }
    for (const a of seeds.accounts) expect(profiles.has(a.ownerProfileId)).toBe(true);
    for (const c of seeds.creditCards) {
      expect(profiles.has(c.ownerProfileId)).toBe(true);
      expect(accounts.has(c.accountId ?? "")).toBe(true);
    }
  });

  it("formato por tipo (transactions_kind_shape) e status × pago (transactions_paid_consistency)", () => {
    for (const x of t) {
      expect(x.amountCents, `${x.id}: valor > 0`).toBeGreaterThan(0);
      const has = { account: !!x.accountId, to: !!x.toAccountId, card: !!x.cardId, category: !!x.categoryId };
      switch (x.kind) {
        case "income":
        case "expense":
          expect(has, x.id).toMatchObject({ account: true, to: false, card: false, category: true });
          break;
        case "credit_card_purchase":
          expect(has, x.id).toMatchObject({ account: false, to: false, card: true, category: true });
          break;
        case "transfer":
          expect(has, x.id).toMatchObject({ account: true, to: true, card: false, category: false });
          expect(x.accountId).not.toBe(x.toAccountId);
          break;
        case "card_payment":
          expect(has, x.id).toMatchObject({ account: true, to: false, card: true, category: false });
          expect(x.status).toBe("paid");
          break;
        case "debt_payment":
          expect(has, x.id).toMatchObject({ account: true, to: false, card: false });
          break;
        case "investment":
        case "redemption":
          expect(has, x.id).toMatchObject({ account: true, to: true, card: false });
          expect(x.accountId).not.toBe(x.toAccountId);
          break;
      }
      if (x.kind === "credit_card_purchase") {
        expect(x.status, `${x.id}: compra no cartão nunca é paga`).not.toBe("paid");
        expect(x.paidAt).toBeUndefined();
      } else if (x.kind === "card_payment") {
        expect(x.paidAt).toBeDefined();
      } else {
        expect(x.status === "paid", `${x.id}: pago ⇔ paidAt`).toBe(x.paidAt !== undefined);
      }
    }
  });

  it("categoria compatível com o tipo (receita × despesa)", () => {
    for (const x of t) {
      const c = x.categoryId ? categories.get(x.categoryId) : undefined;
      if (!c) continue;
      if (x.kind === "income") expect(["income", "both"], `${x.id}`).toContain(c.kind);
      if (x.kind === "expense" || x.kind === "credit_card_purchase") expect(["expense", "both"], `${x.id}`).toContain(c.kind);
    }
  });

  it("compras parceladas: parcelas 1..n sem buracos, soma = valor original, mesma compra/cartão", () => {
    for (const p of seeds.installmentPurchases) {
      const parts = t.filter((x) => x.installment?.purchaseId === p.id).sort((a, b) => a.installment!.number - b.installment!.number);
      expect(parts.map((x) => x.installment!.number)).toEqual(Array.from({ length: p.installments }, (_, i) => i + 1));
      expect(sum(parts.map((x) => x.amountCents))).toBe(p.totalCents);
      expect(parts.every((x) => x.cardId === p.cardId && x.installment!.total === p.installments)).toBe(true);
    }
  });

  it("faturas: pagamentos nunca passam do total; cartão não estoura o limite; limite usado coerente", () => {
    const snap = deriveSnapshot({ ...seeds, pockets: seeds.pockets, pocketMovements: seeds.pocketMovements, transactions: t }, TODAY);
    for (const i of snap.invoices) expect(i.paidCents).toBeLessThanOrEqual(i.totalCents);
    for (const c of seeds.creditCards) expect(snap.usedLimits.get(c.id) ?? 0, `limite de ${c.name}`).toBeLessThanOrEqual(c.limitCents);
  });

  it("dívidas: contrato válido, pagamentos ≤ total, restante ≥ 0", () => {
    const snap = deriveSnapshot({ ...seeds, transactions: t }, TODAY);
    for (const d of seeds.debts) {
      expect(d.principalCents).toBeGreaterThan(0);
      expect(d.totalCents).toBeGreaterThanOrEqual(d.principalCents);
      if (d.installments) expect(d.firstDueDate).toBeDefined();
      const s = snap.debts.find((x) => x.debtId === d.id)!;
      expect(s.paidCents).toBeLessThanOrEqual(d.totalCents);
      expect(s.remainingCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("cofrinhos: só contas de consumo ativas, saldo ≥ 0, LASTRO (reservado ≤ saldo), objetivos coerentes", () => {
    const snap = deriveSnapshot({ ...seeds, transactions: t }, TODAY);
    for (const p of seeds.pockets) {
      const account = accounts.get(p.accountId)!;
      expect(account, `${p.name}: conta`).toBeDefined();
      expect(account.type, `${p.name}: conta de consumo`).not.toBe("investment");
      expect(account.active).toBe(true);
      expect(profiles.has(p.profileId)).toBe(true);
      expect(snap.pocketBalances.get(p.id) ?? 0, `${p.name}: saldo`).toBeGreaterThanOrEqual(0);
    }
    for (const a of seeds.accounts) {
      const reserved = snap.accountReserved.get(a.id) ?? 0;
      if (reserved > 0) expect(accountBalance(a, t), `lastro de ${a.name}`).toBeGreaterThanOrEqual(reserved);
    }
    const linked = new Set<string>();
    for (const g of seeds.goals) {
      expect(g.targetCents).toBeGreaterThan(0);
      expect(profiles.has(g.profileId)).toBe(true);
      if (g.pocketId) {
        expect(seeds.pockets.some((p) => p.id === g.pocketId), `${g.name}: cofrinho existe`).toBe(true);
        expect(g.manualAmountCents, `${g.name}: ligado ⇒ manual 0`).toBe(0);
        expect(linked.has(g.pocketId), "um cofrinho por objetivo").toBe(false);
        linked.add(g.pocketId);
      } else {
        expect(g.manualAmountCents).toBeGreaterThanOrEqual(0);
      }
    }
    for (const m of seeds.pocketMovements) expect(seeds.pockets.some((p) => p.id === m.pocketId)).toBe(true);
  });

  it("campos que o banco não representa não aparecem na demonstração (ex.: split de despesas do casal)", () => {
    expect(t.some((x) => x.split !== undefined)).toBe(false);
  });

  it("contas: ids de dono válidos e cartões apontam para conta de consumo", () => {
    for (const c of seeds.creditCards) expect(accounts.get(c.accountId ?? "")?.type).not.toBe("investment");
  });
});

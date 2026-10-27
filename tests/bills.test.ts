import { describe, expect, it } from "vitest";
import { billsAsText, buildMonthBills, guessCategory, isDuplicateBill, parseBillList, planBill, type BillDraft } from "@/domain/bills";
import { CALENDAR_ALL } from "@/domain/calendar";
import type { Category } from "@/domain/types";
import { formatMoney } from "@/lib/format";
import { camila, nubank, santander, TODAY, tx, workspace, yan } from "./helpers";

describe("colar lista do WhatsApp", () => {
  it("lê valor antes ou depois do nome, milhar com ponto, ok/✅ e ignora títulos", () => {
    const { items, ignored } = parseBillList(`Contas que temos a pagar
Outubro

Cartao mais 2400
Felipe 1800 ✅
1.100 empréstimo. Ok
1.300 tio zezinho. Ok
777 passagem nossa+ Lara
note jessica 310✅
1. R$ 113,50 — TIM Rosa

Tira os ok pff da lista`);
    expect(ignored).toBe(3);
    expect(items.map((i) => [i.description, i.amountCents, i.paid])).toEqual([
      ["Cartao mais", 240000, false],
      ["Felipe", 180000, true],
      ["Empréstimo", 110000, true],
      ["Tio zezinho", 130000, true],
      ["Passagem nossa+ Lara", 77700, false],
      ["Note jessica", 31000, true],
      ["TIM Rosa", 11350, false],
    ]);
  });

  it("(5x10) e 5/10 viram parcela atual/total", () => {
    const { items } = parseBillList("60 tia val (5x10) ok\nGeladeira 5/10 250");
    expect(items[0]).toMatchObject({ description: "Tia val", amountCents: 6000, paid: true, installment: { current: 5, total: 10 } });
    expect(items[1]).toMatchObject({ description: "Geladeira", amountCents: 25000, installment: { current: 5, total: 10 } });
  });

  it("linha de total não vira conta", () => {
    expect(parseBillList("TOTAL PENDENTE R$ 1.997,00").items).toHaveLength(0);
  });
});

describe("planBill", () => {
  const base: BillDraft = {
    description: "Água",
    amountCents: 15000,
    dueDate: "2026-10-10",
    profileId: yan.id,
    accountId: nubank.id,
    categoryId: "cat",
    repeat: "once",
    paid: false,
  };

  it("só este mês: uma despesa a pagar com vencimento", () => {
    const plan = planBill(base, TODAY);
    expect(plan.rule).toBeUndefined();
    expect(plan.transaction).toMatchObject({ kind: "expense", status: "pending", dueDate: "2026-10-10", date: "2026-10-10" });
  });

  it("todo mês: a do mês é despesa comum e a regra começa no mês seguinte (nunca duplica este mês)", () => {
    const plan = planBill({ ...base, repeat: "monthly", paid: true }, TODAY);
    expect(plan.transaction).toMatchObject({ status: "paid", paidAt: TODAY });
    expect(plan.rule).toMatchObject({ frequency: "monthly", interval: 1, startDate: "2026-11-10", endDate: undefined });
  });

  it("parcela 5/10: regra até a parcela 10; a última parcela não cria regra", () => {
    const plan = planBill({ ...base, repeat: "installments", installment: { current: 5, total: 10 } }, TODAY);
    expect(plan.transaction.description).toBe("Água (5/10)");
    expect(plan.rule).toMatchObject({ startDate: "2026-11-10", endDate: "2027-03-10" });
    expect(planBill({ ...base, repeat: "installments", installment: { current: 10, total: 10 } }, TODAY).rule).toBeUndefined();
  });
});

describe("contas do mês", () => {
  const data = workspace({
    transactions: [
      tx({ status: "pending", date: "2026-10-15", dueDate: "2026-10-15", amountCents: 15000, accountId: nubank.id, description: "Água" }),
      tx({ status: "pending", date: "2026-09-20", dueDate: "2026-09-20", amountCents: 7000, accountId: santander.id, description: "Tim Camila", profileId: camila.id }),
      tx({ status: "paid", date: "2026-10-05", dueDate: "2026-10-05", amountCents: 40000, accountId: nubank.id, description: "Aluguel" }),
      // gasto do dia a dia (sem vencimento): não é conta
      tx({ status: "paid", date: "2026-10-03", amountCents: 9000, accountId: nubank.id, description: "Mercado" }),
      tx({ kind: "income", status: "pending", date: "2026-10-20", amountCents: 500000, accountId: nubank.id, description: "Salário" }),
    ],
  });

  it("em aberto (com atrasada de mês anterior), pagas só as contas, e o total pendente", () => {
    const b = buildMonthBills(data, "2026-10", CALENDAR_ALL, TODAY);
    expect(b.open.map((x) => [x.title, x.carried, x.status])).toEqual([
      ["Tim Camila", true, "overdue"],
      ["Água", false, "pending"],
    ]);
    expect(b.paid.map((x) => x.title)).toEqual(["Aluguel"]);
    expect(b.openCents).toBe(22000);
    expect(b.paidCents).toBe(40000);
    expect(b.overdueCount).toBe(1);
  });

  it("filtra por pessoa", () => {
    const b = buildMonthBills(data, "2026-10", camila.id, TODAY);
    expect(b.open.map((x) => x.title)).toEqual(["Tim Camila"]);
    expect(b.paid).toHaveLength(0);
  });

  it("atrasadas antigas não aparecem num mês passado", () => {
    expect(buildMonthBills(data, "2026-09", CALENDAR_ALL, TODAY).open.map((x) => x.carried)).toEqual([false]);
  });

  it("texto para o WhatsApp e detecção de duplicada", () => {
    const b = buildMonthBills(data, "2026-10", CALENDAR_ALL, TODAY);
    const text = billsAsText(b, "Outubro", formatMoney);
    expect(text).toContain("Água");
    expect(text).toContain("Aluguel ✅");
    expect(text).toContain("Total pendente: R$ 220,00 (2 contas)");
    expect(isDuplicateBill({ description: "agua", amountCents: 15000 }, b)).toBe(true);
    expect(isDuplicateBill({ description: "agua", amountCents: 16000 }, b)).toBe(false);
  });
});

describe("guessCategory", () => {
  const cat = (id: string, name: string, parentId?: string): Category => ({ id, name, parentId, icon: "x", color: "#000", kind: "expense", active: true });
  const categories = [cat("moradia", "Moradia"), cat("agua", "Água", "moradia"), cat("dividas", "Dívidas")];

  it("acha pelo nome, sem acento, preferindo subcategoria", () => {
    expect(guessCategory("150 agua", categories)).toBe("agua");
    expect(guessCategory("Dividas tio", categories)).toBe("dividas");
    expect(guessCategory("Renner", categories)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { pocketUses } from "@/domain/pockets";
import type { Goal, Pocket, PocketMovement } from "@/domain/types";
import { buildGoalsView, buildPocketsView } from "@/services/pocket-view";
import { casal, camila, nubank, santander, TODAY, tx, workspace, yan } from "./helpers";

const pocket = (id: string, accountId: string, profileId: string, over: Partial<Pocket> = {}): Pocket => ({
  id, name: id, icon: "piggy-bank", color: "#000000", profileId, accountId, status: "active", createdAt: "2026-01-01T00:00:00Z", ...over,
});
const move = (id: string, pocketId: string, kind: PocketMovement["kind"], amountCents: number, over: Partial<PocketMovement> = {}): PocketMovement => ({
  id, pocketId, kind, amountCents, date: TODAY, createdAt: "2026-01-01T00:00:00Z", ...over,
});
const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id, name: id, kind: "other", targetCents: 100000, profileId: yan.id, icon: "target", color: "#000000", status: "active", manualAmountCents: 0, ...over,
});

const data = () =>
  workspace({
    pockets: [pocket("a", nubank.id, yan.id), pocket("b", nubank.id, yan.id, { status: "archived" }), pocket("c", santander.id, camila.id), pocket("d", nubank.id, casal.id)],
    pocketMovements: [move("m1", "a", "reserve", 30000), move("m2", "c", "reserve", 10000), move("m3", "d", "reserve", 5000), move("m4", "a", "withdraw", 1000)],
    goals: [
      goal("g1", { pocketId: "a", deadline: "2027-01-01" }),
      goal("g2", { manualAmountCents: 25000, deadline: "2026-12-01" }),
      goal("g3", { profileId: camila.id, status: "completed" }),
    ],
  });

describe("visão de cofrinhos (derivada, sem saldo gravado)", () => {
  it("saldo do cofrinho, reservado/livre da conta e objetivo ligado; arquivados à parte", () => {
    const v = buildPocketsView(data(), TODAY);
    const a = v.active.find((c) => c.pocket.id === "a")!;
    expect(a).toMatchObject({ balanceCents: 29000, accountReservedCents: 34000, accountBalanceCents: 100000, accountFreeCents: 66000 });
    expect(a.goal?.id).toBe("g1");
    expect(v.archived.map((c) => c.pocket.id)).toEqual(["b"]);
    expect(v.reservedCents).toBe(29000 + 10000 + 5000);
  });

  it("dinheiro livre soma as contas de consumo ativas (nunca investimentos) e respeita o filtro de pessoa", () => {
    const all = buildPocketsView(data(), TODAY);
    // nubank 100.000 − 34.000 + santander 100.000 − 10.000 + mercado pago 0 = 156.000
    expect(all.freeCents).toBe(66000 + 90000 + 0);
    const onlyCamila = buildPocketsView(data(), TODAY, camila.id);
    expect(onlyCamila.active.map((c) => c.pocket.id)).toEqual(["c"]);
    expect(onlyCamila.reservedCents).toBe(10000);
    const casalView = buildPocketsView(data(), TODAY, casal.id);
    expect(casalView.active.map((c) => c.pocket.id)).toEqual(["d"]);
  });

  it("perfil desconhecido cai em Todos", () => {
    expect(buildPocketsView(data(), TODAY, "nao-existe").active).toHaveLength(3);
  });
});

describe("visão de objetivos", () => {
  it("ligado = saldo real do cofrinho; manual = valor informado; prazo em dias; ordem por prazo", () => {
    const v = buildGoalsView(data(), TODAY);
    expect(v.active.map((c) => c.goal.id)).toEqual(["g2", "g1"]);
    expect(v.closed.map((c) => c.goal.id)).toEqual(["g3"]);
    const g1 = v.active.find((c) => c.goal.id === "g1")!;
    expect(g1.progress).toMatchObject({ source: "pocket", currentCents: 29000, percent: 29 });
    expect(g1.daysLeft).toBeGreaterThan(0);
    expect(v.active.find((c) => c.goal.id === "g2")!.progress).toMatchObject({ source: "manual", currentCents: 25000 });
  });

  it("filtro por pessoa", () => {
    expect(buildGoalsView(data(), TODAY, camila.id).closed.map((c) => c.goal.id)).toEqual(["g3"]);
    expect(buildGoalsView(data(), TODAY, camila.id).active).toHaveLength(0);
  });
});

describe("despesas que usaram cofrinho (derivadas dos movimentos use / use_reversal)", () => {
  it("mapeia a despesa, o cofrinho, o valor usado e se foi estornada", () => {
    const t1 = tx({});
    const t2 = tx({});
    const uses = pocketUses([
      move("u1", "a", "use", 4000, { transactionId: t1.id }),
      move("u2", "a", "use", 1500, { transactionId: t2.id }),
      move("r2", "a", "use_reversal", 1500, { transactionId: t2.id, reversesId: "u2" }),
      move("x", "a", "reserve", 1),
    ]);
    expect(uses.get(t1.id)).toEqual({ transactionId: t1.id, pocketId: "a", amountCents: 4000, reversed: false });
    expect(uses.get(t2.id)).toMatchObject({ amountCents: 1500, reversed: true });
    expect(uses.size).toBe(2);
  });
});

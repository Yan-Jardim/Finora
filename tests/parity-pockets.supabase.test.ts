/**
 * PARIDADE DE COFRINHOS E OBJETIVOS: o mesmo roteiro roda no motor LOCAL (domain/pockets + local-pocket) e no SUPABASE REAL
 * (RPCs + views v_pocket_balances / v_account_reserves). Saldo do cofrinho, reservado/livre por conta, histórico, progresso
 * dos objetivos E os códigos de erro precisam ser IGUAIS. Integração: só com o usuário descartável (veja o harness).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/repositories/supabase/errors";
import { ENABLED, makeLocal, makeSupabase, metrics, pocketMetrics, today, type Side, type SupabaseSide } from "./support/parity-harness";

describe.skipIf(!ENABLED)("paridade de cofrinhos: motor local x Supabase (usuário descartável)", { timeout: 240_000 }, () => {
  let local: Side;
  let remote: Side;
  let sb: SupabaseSide;
  const both = async <T,>(fn: (s: Side) => Promise<T>) => [await fn(local), await fn(remote)] as [T, T];
  const same = async (label: string) => {
    const [l, r] = [await pocketMetrics(local), await pocketMetrics(remote)];
    expect(r, label).toEqual(l);
    expect(metrics(remote).balances, label + " (saldos)").toEqual(metrics(local).balances);
    expect(metrics(remote).dashboard.available, label + " (disponível)").toEqual(metrics(local).dashboard.available);
    return l;
  };
  /** Código do erro nos DOIS motores (e a mensagem igual). */
  const bothFail = async (fn: (s: Side) => Promise<unknown>) => {
    const out: { code?: string; message: string }[] = [];
    for (const s of [local, remote]) {
      try {
        await fn(s);
        out.push({ code: "SEM_ERRO", message: "" });
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        out.push({ code: (e as AppError).code, message: (e as Error).message });
      }
    }
    expect(out[1], "supabase x local").toEqual(out[0]);
    return out[0].code;
  };
  const idOf = (s: Side, name: string) => s.data.pockets.find((p) => p.name === name)!.id;
  const goalOf = (s: Side, name: string) => s.data.goals.find((g) => g.name === name)!.id;
  const newPocket = (name: string, over: { initialCents?: number; account?: "accA" | "accB"; legacyRef?: string } = {}) =>
    both((s) => s.pocket.create({ name, profileId: s.ids.profile, accountId: s.ids[over.account ?? "accA"], initialCents: over.initialCents, legacyRef: over.legacyRef }));
  const refresh = async () => {
    await local.refresh();
    await remote.refresh();
  };

  beforeAll(async () => {
    local = makeLocal();
    sb = await makeSupabase();
    remote = sb.side;
    await local.refresh();
  });
  afterAll(async () => {
    if (sb) await sb.cleanup();
  });

  it("criar com reserva inicial e vazio: saldo, reservado e livre iguais; sem despesa, saldo bancário intacto", async () => {
    const before = metrics(remote).balances;
    await newPocket("Emergência", { initialCents: 30000 });
    await newPocket("Viagem");
    const m = await same("criados");
    expect(m.pockets.map((p) => [p.name, p.balance])).toEqual([["Emergência", 30000], ["Viagem", 0]]);
    expect(m.accounts.find((a) => a.account === "A")).toMatchObject({ balance: 100000, reserved: 30000, free: 70000 });
    expect(metrics(remote).balances).toEqual(before);
    expect(remote.data.transactions).toHaveLength(0);
  });

  it("criar: recusas iguais (conta de investimento, valor acima do livre, nome vazio)", async () => {
    expect(await bothFail((s) => s.pocket.create({ name: "X", profileId: s.ids.profile, accountId: s.ids.accInvest }))).toBe("account_not_allowed");
    expect(await bothFail((s) => s.pocket.create({ name: "X", profileId: s.ids.profile, accountId: s.ids.accA, initialCents: 70001 }))).toBe("insufficient_free");
    await bothFail((s) => s.pocket.create({ name: "  ", profileId: s.ids.profile, accountId: s.ids.accA }));
    await same("nada ficou");
  });

  it("importação idempotente por legacy_ref: repetir devolve o mesmo cofrinho e não duplica a reserva", async () => {
    const [l1, r1] = await newPocket("Antigo", { initialCents: 10000, legacyRef: "legacy:k9" });
    const [l2, r2] = await newPocket("Antigo", { initialCents: 10000, legacyRef: "legacy:k9" });
    expect([l2, r2]).toEqual([l1, r1]);
    const m = await same("idempotente");
    expect(m.accounts.find((a) => a.account === "A")!.reserved).toBe(40000);
    await refresh();
    await both((s) => s.pocket.withdraw({ pocketId: idOf(s, "Antigo"), amountCents: 10000 }));
    await same("liberou o legado");
  });

  it("reservar e retirar: só alocação virtual (saldo bancário fixo, livre muda); recusas iguais", async () => {
    await refresh();
    await both((s) => s.pocket.reserve({ pocketId: idOf(s, "Viagem"), amountCents: 20000, note: "mensal" }));
    await same("reservou");
    await both((s) => s.pocket.withdraw({ pocketId: idOf(s, "Viagem"), amountCents: 5000 }));
    const m = await same("retirou");
    expect(m.pockets.find((p) => p.name === "Viagem")!.balance).toBe(15000);
    expect(await bothFail((s) => s.pocket.withdraw({ pocketId: idOf(s, "Viagem"), amountCents: 15001 }))).toBe("insufficient_pocket");
    expect(await bothFail((s) => s.pocket.reserve({ pocketId: idOf(s, "Viagem"), amountCents: 99999999 }))).toBe("insufficient_free");
    expect(await bothFail((s) => s.pocket.reserve({ pocketId: idOf(s, "Viagem"), amountCents: 0 }))).toBe("invalid_amount");
    await same("recusas não deixaram rastro");
  });

  it("transferir entre cofrinhos da mesma conta; recusas: mesmo cofrinho, outra conta, saldo insuficiente", async () => {
    await newPocket("Outra conta", { account: "accB" });
    await refresh();
    await both((s) => s.pocket.transfer({ fromPocketId: idOf(s, "Emergência"), toPocketId: idOf(s, "Viagem"), amountCents: 10000 }));
    const m = await same("transferiu");
    expect(m.pockets.filter((p) => p.account === "A").reduce((n, p) => n + p.balance, 0)).toBe(30000 + 15000); // total reservado inalterado
    expect(await bothFail((s) => s.pocket.transfer({ fromPocketId: idOf(s, "Viagem"), toPocketId: idOf(s, "Viagem"), amountCents: 1 }))).toBe("same_pocket");
    expect(await bothFail((s) => s.pocket.transfer({ fromPocketId: idOf(s, "Viagem"), toPocketId: idOf(s, "Outra conta"), amountCents: 1 }))).toBe("different_accounts");
    expect(await bothFail((s) => s.pocket.transfer({ fromPocketId: idOf(s, "Emergência"), toPocketId: idOf(s, "Viagem"), amountCents: 999999 }))).toBe("insufficient_pocket");
    await same("recusas");
  });

  it("gastar com a reserva: uso TOTAL e PARCIAL (uma despesa, saldo, reserva e livre iguais) + recusas", async () => {
    await refresh();
    const [a, b] = await both((s) => s.pocket.spend({ pocketId: idOf(s, "Viagem"), description: "Passagem", amountCents: 8000, categoryId: s.ids.catLazer }));
    expect([a.fromPocketCents, a.fromAccountCents]).toEqual([b.fromPocketCents, b.fromAccountCents]);
    const total = await same("uso total");
    expect(total.accounts.find((x) => x.account === "A")).toMatchObject({ balance: 100000 - 8000, reserved: 45000 - 8000 });
    const [pa, pb] = await both((s) => s.pocket.spend({ pocketId: idOf(s, "Emergência"), description: "Mercado", amountCents: 5000, amountFromPocketCents: 3000, categoryId: s.ids.catMercado }));
    expect([pa.fromPocketCents, pa.fromAccountCents]).toEqual([3000, 2000]);
    expect([pb.fromPocketCents, pb.fromAccountCents]).toEqual([3000, 2000]);
    await same("uso parcial");
    expect(await bothFail((s) => s.pocket.spend({ pocketId: idOf(s, "Viagem"), description: "x", amountCents: 100, amountFromPocketCents: 200, categoryId: s.ids.catLazer }))).toBe("amount_from_pocket_invalid");
    expect(await bothFail((s) => s.pocket.spend({ pocketId: idOf(s, "Viagem"), description: "x", amountCents: 100, categoryId: "" }))).toBe("category_required");
    expect(await bothFail((s) => s.pocket.spend({ pocketId: idOf(s, "Viagem"), description: "x", amountCents: 50000, amountFromPocketCents: 50000, categoryId: s.ids.catLazer }))).toBe("insufficient_pocket");
    await same("recusas atômicas");
    expect(remote.data.transactions.filter((t) => t.kind === "expense")).toHaveLength(2);
  });

  it("a despesa do uso é protegida igualmente (excluir/alterar valor/status) e a descrição segue editável", async () => {
    await refresh();
    for (const s of [local, remote]) {
      const expense = s.data.transactions.find((t) => t.description === "Passagem")!;
      let code: string | undefined;
      try {
        await s.commands.delete(expense);
      } catch (e) {
        code = (e as AppError).code;
      }
      expect(code, s.name).toBe("use_pocket_flow");
      code = undefined;
      try {
        await s.commands.update(expense, { amountCents: 1 });
      } catch (e) {
        code = (e as AppError).code;
      }
      expect(code, s.name).toBe("use_pocket_flow");
    }
    await same("intacto");
  });

  it("lastro: despesa/transferência/pagamento acima do livre → reserve_shortfall nos dois; depois de liberar, passa", async () => {
    await refresh();
    const m0 = await same("antes");
    const free = m0.accounts.find((a) => a.account === "A")!.free;
    const expense = (s: Side, cents: number) => s.commands.create({ kind: "expense", description: "Lastro", amountCents: cents, date: today, status: "paid", paidAt: today, tags: [], profileId: s.ids.profile, accountId: s.ids.accA, categoryId: s.ids.catMercado });
    expect(await bothFail((s) => expense(s, free + 1))).toBe("reserve_shortfall");
    await same("bloqueado sem rastro");
    await both((s) => expense(s, free)); // exatamente o livre
    expect(await bothFail((s) => expense(s, 1))).toBe("reserve_shortfall");
    await both((s) => s.pocket.withdraw({ pocketId: idOf(s, "Viagem"), amountCents: 100 }));
    await both((s) => expense(s, 100)); // depois de liberar, a mesma operação passa
    await same("liberou e passou");
  });

  it("estornar o uso: despesa cancelada, valor volta, histórico preservado (uso + estorno); estorno duplo e sem uso recusados", async () => {
    await refresh();
    const useTx = (s: Side, desc: string) => s.data.transactions.find((t) => t.description === desc)!.id;
    const before = await pocketMetrics(remote);
    await both((s) => s.pocket.reverseUse(useTx(s, "Mercado"), "desisti"));
    const m = await same("estornou parcial");
    expect(m.history.filter((h) => h.kind === "use_reversal")).toHaveLength(1);
    expect(m.pockets.find((p) => p.name === "Emergência")!.balance).toBe(before.pockets.find((p) => p.name === "Emergência")!.balance + 3000);
    expect(await bothFail((s) => s.pocket.reverseUse(useTx(s, "Mercado")))).toBe("already_reversed");
    expect(await bothFail((s) => s.pocket.reverseUse(useTx(s, "Lastro")))).toBe("no_pocket_use");
    await both((s) => s.pocket.reverseUse(useTx(s, "Passagem")));
    await same("estornou total");
  });

  it("edição de CONTA com reserva: reduzir saldo inicial, arquivar e virar investimento seguem o mesmo lastro nos dois motores", async () => {
    await refresh();
    const m = await same("antes");
    const reserved = m.accounts.find((a) => a.account === "A")!.reserved;
    expect(reserved).toBeGreaterThan(0);
    const accA = (s: Side) => s.data.accounts.find((a) => a.id === s.ids.accA)!;
    const free = m.accounts.find((a) => a.account === "A")!.free;
    // reduzir além da folga: bloqueia
    expect(await bothFail((s) => s.accounts.update(s.ids.accA, { initialBalanceCents: accA(s).initialBalanceCents - free - 1 }))).toBe("reserve_shortfall");
    expect(await bothFail((s) => s.accounts.update(s.ids.accA, { active: false }))).toBe("account_has_reserve");
    expect(await bothFail((s) => s.accounts.update(s.ids.accA, { type: "investment" }))).toBe("account_has_reserve");
    await same("nada mudou");
    // reduzir exatamente a folga: passa; aumentar sempre passa
    await both((s) => s.accounts.update(s.ids.accA, { initialBalanceCents: accA(s).initialBalanceCents - free }));
    await same("reduziu a folga");
    await refresh();
    await both((s) => s.accounts.update(s.ids.accA, { initialBalanceCents: accA(s).initialBalanceCents + free }));
    await same("restaurou");
    // conta SEM reserva (B): nada é bloqueado
    await both((s) => s.accounts.update(s.ids.accB, { initialBalanceCents: -50000, active: false }));
    await both((s) => s.accounts.update(s.ids.accB, { active: true }));
    await same("conta sem reserva livre");
  });

  it("arquivar exige saldo 0; reativar; movimentar arquivado é recusado igual", async () => {
    await refresh();
    expect(await bothFail((s) => s.pocket.setArchived(idOf(s, "Emergência"), true))).toBe("pocket_has_balance");
    await newPocket("Temporário");
    await refresh();
    await both((s) => s.pocket.setArchived(idOf(s, "Temporário"), true));
    expect(await bothFail((s) => s.pocket.reserve({ pocketId: idOf(s, "Temporário"), amountCents: 1 }))).toBe("pocket_archived");
    await same("arquivado");
    await both((s) => s.pocket.setArchived(idOf(s, "Temporário"), false));
    await both((s) => s.pocket.update(idOf(s, "Temporário"), { name: "Renomeado", description: "d", color: "#112233" }));
    await same("reativado e editado");
  });

  it("objetivos: manual (valor informado) x ligado (saldo real do cofrinho); ligar zera o manual; um cofrinho por objetivo", async () => {
    await refresh();
    await both(async (s) => {
      const base = { kind: "travel" as const, targetCents: 100000, profileId: s.ids.profile, icon: "target", color: "#4f46e5", status: "active" as const };
      await s.goals.create({ ...base, name: "Meta manual", manualAmountCents: 25000 });
      await s.goals.create({ ...base, name: "Meta ligada", manualAmountCents: 4000 });
      await s.goals.create({ ...base, name: "Meta extra", manualAmountCents: 0 });
    });
    await refresh();
    const manual = await same("manual");
    expect(manual.goals.find((x) => x.name === "Meta manual")!.progress).toMatchObject({ source: "manual", currentCents: 25000 });
    const reservedBefore = manual.accounts.find((a) => a.account === "A")!.reserved;

    await both((s) => s.pocket.linkGoal(goalOf(s, "Meta ligada"), idOf(s, "Emergência")));
    const linked = await same("ligado");
    const goal = linked.goals.find((x) => x.name === "Meta ligada")!;
    expect(goal).toMatchObject({ linked: "Emergência", manual: 0 }); // ligar zera o manual (não é restaurado ao desligar)
    expect(goal.progress.source).toBe("pocket");
    expect(linked.accounts.find((a) => a.account === "A")!.reserved).toBe(reservedBefore); // objetivo não é reserva
    expect(await bothFail((s) => s.pocket.linkGoal(goalOf(s, "Meta extra"), idOf(s, "Emergência")))).toBe("pocket_already_linked");
    await both((s) => s.pocket.linkGoal(goalOf(s, "Meta ligada"), null));
    const unlinked = await same("desligado");
    expect(unlinked.goals.find((x) => x.name === "Meta ligada")).toMatchObject({ linked: null, manual: 0 });
  });

  it("importação dos cofrinhos antigos (Supabase real): só por ação explícita, idempotente, respeita o lastro e não apaga a chave", async () => {
    const key = `finora:v1:sb:${sb.householdId}:pockets`;
    const accB = remote.ids.accB;
    // Conta B tem R$ 0,00: o "antigo" não cabe (sem reserva + aviso); com saldo, cabe.
    await both((s) => s.accounts.update(s.ids.accB, { initialBalanceCents: 30000 }));
    const legacy = [
      { id: "o1", name: "Legado cabe", accountId: accB, amountCents: 20000 },
      { id: "o2", name: "Legado grande", accountId: accB, amountCents: 99999900 },
      { id: "o3", name: "Legado órfão", accountId: "00000000-0000-0000-0000-000000000000", amountCents: 100 },
    ];
    window.localStorage.setItem(key, JSON.stringify(legacy));
    expect(sb.source.readLegacyPockets?.().map((p) => p.id)).toEqual(["o1", "o2", "o3"]);
    await remote.refresh();
    expect(remote.data.pockets.some((p) => p.name.startsWith("Legado"))).toBe(false); // nada importado sozinho

    const first = await sb.source.importLegacyPockets!();
    expect([first.imported, first.withoutReserve.length, first.failed.length]).toEqual([1, 1, 1]);
    expect(first.withoutReserve[0]).toMatchObject({ name: "Legado grande", amountCents: 99999900 });
    const again = await sb.source.importLegacyPockets!();
    expect([again.imported, again.alreadyImported]).toEqual([0, 2]); // idempotente: não duplica nem a reserva
    await remote.refresh();
    const m = await pocketMetrics(remote);
    expect(m.pockets.filter((p) => p.name.startsWith("Legado")).map((p) => [p.name, p.balance, p.legacy])).toEqual([
      ["Legado cabe", 20000, "legacy:o1"],
      ["Legado grande", 0, "legacy:o2"],
    ]);
    expect(window.localStorage.getItem(key)).toBe(JSON.stringify(legacy)); // a chave antiga NUNCA é apagada
  });
});

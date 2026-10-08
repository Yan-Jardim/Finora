import { beforeEach, describe, expect, it } from "vitest";
import { accountBalance } from "@/domain/calculations";
import { backingShortfall, goalProgress, movementSign, pocketBalances, reservedByAccount, signedCents } from "@/domain/pockets";
import { snapshotFree, snapshotOf, snapshotPocketBalance, snapshotReserved } from "@/domain/snapshot";
import type { Goal, PocketMovement, WorkspaceData } from "@/domain/types";
import { AppError } from "@/repositories/supabase/errors";
import { ALL_PROFILES, buildDashboard } from "@/services/dashboard-service";
import { LocalDebtCommands } from "@/services/local-debt";
import { LocalPocketCommands } from "@/services/local-pocket";
import { LocalTransactionCommands } from "@/services/local-transaction-commands";
import { card, casal, createRepos, installFakeStorage, invest, camila, mercadoPago, nubank, santander, TODAY, tx, workspace, yan } from "./helpers";

const CAT = "cat-exp";
let repos: ReturnType<typeof createRepos>;
let pocket: LocalPocketCommands;
let txs: LocalTransactionCommands;
let debts: LocalDebtCommands;
let current: WorkspaceData;

async function load(): Promise<WorkspaceData> {
  current = workspace({
    accounts: await repos.accounts.list(),
    transactions: await repos.transactions.list(),
    pockets: await repos.pockets.list(),
    pocketMovements: await repos.pocketMovements.list(),
    goals: await repos.goals.list(),
    debts: await repos.debts.list(),
  });
  return current;
}

/** Saldo, reservado e livre DERIVADOS (as mesmas funções que o app usa). */
async function money(accountId = nubank.id) {
  const data = await load();
  const snap = snapshotOf(data, TODAY);
  const account = data.accounts.find((a) => a.id === accountId)!;
  return {
    balance: accountBalance(account, data.transactions),
    reserved: snapshotReserved(snap, accountId),
    free: snapshotFree(snap, account),
    txCount: data.transactions.length,
    movementCount: data.pocketMovements.length,
    pocketBalance: (id: string) => snapshotPocketBalance(snap, { id }),
  };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error("esperava um erro");
};
const message = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("esperava um erro");
};

beforeEach(() => {
  installFakeStorage();
  repos = createRepos({ accounts: [nubank, mercadoPago, santander, invest], profiles: [yan, camila, casal] });
  pocket = new LocalPocketCommands(
    { pockets: repos.pockets, pocketMovements: repos.pocketMovements, goals: repos.goals, accounts: repos.accounts, profiles: repos.profiles, transactions: repos.transactions },
    { today: () => TODAY },
  );
  txs = new LocalTransactionCommands(repos, { today: () => TODAY, data: () => current });
  debts = new LocalDebtCommands(repos, { today: () => TODAY });
});

const newPocket = (over: Partial<Parameters<typeof pocket.create>[0]> = {}) => pocket.create({ name: "Viagem", profileId: yan.id, accountId: nubank.id, ...over });

describe("domínio: saldo derivado do histórico (nada gravado)", () => {
  const m = (kind: PocketMovement["kind"], amountCents: number, pocketId = "p1"): PocketMovement => ({ id: `${kind}${amountCents}${pocketId}`, pocketId, kind, amountCents, date: TODAY, createdAt: "x" });

  it("sinais: reserve/transfer_in/use_reversal somam; withdraw/transfer_out/use subtraem", () => {
    expect(["reserve", "transfer_in", "use_reversal"].map((k) => movementSign(k as PocketMovement["kind"]))).toEqual([1, 1, 1]);
    expect(["withdraw", "transfer_out", "use"].map((k) => movementSign(k as PocketMovement["kind"]))).toEqual([-1, -1, -1]);
    expect(signedCents(m("use", 300))).toBe(-300);
  });

  it("saldo por cofrinho e reservado por conta", () => {
    const list = [m("reserve", 1000), m("use", 300), m("use_reversal", 300), m("withdraw", 200), m("reserve", 500, "p2")];
    expect(pocketBalances(list).get("p1")).toBe(800);
    expect(reservedByAccount([{ id: "p1", accountId: "a" }, { id: "p2", accountId: "a" }] as never, list).get("a")).toBe(1300);
  });

  it("regra de lastro: só confere conta com reserva cuja folga DIMINUIU (conta no vermelho sem reserva nunca é verificada)", () => {
    const negative = { ...nubank, id: "neg", initialBalanceCents: -5000 };
    const pockets = [{ id: "p1", accountId: nubank.id }] as never;
    const movements = [m("reserve", 60000)];
    const before = [tx({ kind: "expense", amountCents: 10000, accountId: nubank.id, status: "paid" })];
    const worse = [...before, tx({ kind: "expense", amountCents: 40000, accountId: nubank.id, status: "paid" })];
    expect(backingShortfall({ accounts: [nubank], pockets, movements, before, after: worse, touched: [nubank.id] })).toMatchObject({ shortfallCents: 10000, reservedCents: 60000, balanceCents: 50000 });
    const income = [...before, tx({ kind: "income", amountCents: 5000, accountId: nubank.id, status: "paid" })];
    expect(backingShortfall({ accounts: [nubank], pockets, movements, before, after: income, touched: [nubank.id] })).toBeNull();
    expect(backingShortfall({ accounts: [negative], pockets: [], movements: [], before: [], after: [tx({ kind: "expense", amountCents: 9999999, accountId: "neg", status: "paid" })], touched: ["neg"] })).toBeNull();
  });
});

describe("criar cofrinho", () => {
  it("cria com reserva inicial: saldo derivado, sem despesa e sem mexer no saldo bancário", async () => {
    const before = await money();
    const id = await newPocket({ initialCents: 30000, description: "Inglaterra" });
    const after = await money();
    expect(after.pocketBalance(id)).toBe(30000);
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(30000);
    expect(after.free).toBe(before.free - 30000);
    expect(after.txCount).toBe(before.txCount);
    const [p] = await repos.pockets.list();
    expect(p).toMatchObject({ name: "Viagem", description: "Inglaterra", status: "active", icon: "piggy-bank" });
    expect(p).not.toHaveProperty("amountCents"); // o saldo NÃO é guardado no cofrinho
  });

  it("recusa: conta de investimento, conta inexistente, perfil inexistente, nome inválido, valor inicial acima do livre", async () => {
    expect(await code(newPocket({ accountId: invest.id }))).toBe("account_not_allowed");
    expect(await code(newPocket({ accountId: "nao-existe" }))).toBe("account_not_allowed");
    expect(await code(newPocket({ profileId: "nao-existe" }))).toBe("profile_not_found");
    expect(await code(newPocket({ name: "   " }))).toBe("pockets_name_check");
    expect(await code(newPocket({ name: "x".repeat(61) }))).toBe("pockets_name_check");
    expect(await code(newPocket({ initialCents: -1 }))).toBe("invalid_amount");
    expect(await code(newPocket({ initialCents: 100001 }))).toBe("insufficient_free");
    expect((await repos.pockets.list()).length).toBe(0); // nenhuma tentativa deixou cofrinho
  });

  it("conta inativa não aceita cofrinho", async () => {
    await repos.accounts.update(nubank.id, { active: false });
    expect(await code(newPocket())).toBe("account_not_allowed");
  });

  it("importação idempotente por legacyRef: não duplica o cofrinho nem a reserva", async () => {
    const a = await newPocket({ initialCents: 10000, legacyRef: "legacy:k1" });
    const b = await newPocket({ initialCents: 10000, legacyRef: "legacy:k1" });
    expect(b).toBe(a);
    expect((await repos.pockets.list()).length).toBe(1);
    expect((await money()).reserved).toBe(10000);
  });
});

describe("reservar e retirar (alocação virtual)", () => {
  it("reservar: não altera o saldo bancário, não cria despesa e REDUZ o livre", async () => {
    const id = await newPocket();
    const before = await money();
    await pocket.reserve({ pocketId: id, amountCents: 20000 });
    const after = await money();
    expect(after.balance).toBe(before.balance);
    expect(after.txCount).toBe(before.txCount);
    expect(after.free).toBe(before.free - 20000);
    expect(after.pocketBalance(id)).toBe(20000);
  });

  it("retirar: não altera o saldo bancário e AUMENTA o livre", async () => {
    const id = await newPocket({ initialCents: 30000 });
    const before = await money();
    await pocket.withdraw({ pocketId: id, amountCents: 5000 });
    const after = await money();
    expect(after.balance).toBe(before.balance);
    expect(after.free).toBe(before.free + 5000);
    expect(after.pocketBalance(id)).toBe(25000);
  });

  it("reservar acima do livre / retirar acima do reservado / valor inválido / data futura / cofrinho arquivado", async () => {
    const id = await newPocket({ initialCents: 30000 });
    expect(await code(pocket.reserve({ pocketId: id, amountCents: 70001 }))).toBe("insufficient_free");
    expect(await message(pocket.reserve({ pocketId: id, amountCents: 70001 }))).toContain("R$ 0,01"); // faltam R$ 0,01
    expect(await code(pocket.withdraw({ pocketId: id, amountCents: 30001 }))).toBe("insufficient_pocket");
    expect(await code(pocket.reserve({ pocketId: id, amountCents: 0 }))).toBe("invalid_amount");
    expect(await code(pocket.reserve({ pocketId: id, amountCents: 1, date: "2026-10-07" }))).toBe("future_date");
    expect(await code(pocket.reserve({ pocketId: "nao-existe", amountCents: 1 }))).toBe("pocket_not_found");
    await pocket.withdraw({ pocketId: id, amountCents: 30000 });
    await pocket.setArchived(id, true);
    expect(await code(pocket.reserve({ pocketId: id, amountCents: 1 }))).toBe("pocket_archived");
  });

  it("conta no vermelho: não dá para reservar (livre negativo), mas o resto da conta segue funcionando", async () => {
    await repos.accounts.update(nubank.id, { initialBalanceCents: -20000 });
    const id = await newPocket({ accountId: mercadoPago.id });
    expect(await code(pocket.reserve({ pocketId: id, amountCents: 1 }))).toBe("insufficient_free");
    // despesa na conta no vermelho SEM reservas continua permitida (regra anterior aos cofrinhos)
    await txs.create({ kind: "expense", description: "x", amountCents: 5000, date: TODAY, status: "paid", paidAt: TODAY, tags: [], profileId: yan.id, accountId: nubank.id, categoryId: CAT });
  });
});

describe("transferir reserva entre cofrinhos", () => {
  it("mesma conta: não altera saldo nem o reservado total; as duas pontas ficam ligadas", async () => {
    const a = await newPocket({ name: "A", initialCents: 30000 });
    const b = await newPocket({ name: "B" });
    const before = await money();
    const group = await pocket.transfer({ fromPocketId: a, toPocketId: b, amountCents: 10000 });
    const after = await money();
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(before.reserved);
    expect(after.free).toBe(before.free);
    expect([after.pocketBalance(a), after.pocketBalance(b)]).toEqual([20000, 10000]);
    const grouped = (await repos.pocketMovements.list()).filter((m) => m.transferGroupId === group);
    expect(grouped.map((m) => m.kind).sort()).toEqual(["transfer_in", "transfer_out"]);
  });

  it("recusa: mesmo cofrinho, contas diferentes, acima do saldo, destino arquivado (e nada fica pela metade)", async () => {
    const a = await newPocket({ name: "A", initialCents: 30000 });
    const other = await newPocket({ name: "Outra conta", accountId: santander.id });
    const archived = await newPocket({ name: "Arquivado" });
    await pocket.setArchived(archived, true);
    const movementsBefore = (await repos.pocketMovements.list()).length;
    expect(await code(pocket.transfer({ fromPocketId: a, toPocketId: a, amountCents: 1 }))).toBe("same_pocket");
    expect(await code(pocket.transfer({ fromPocketId: a, toPocketId: other, amountCents: 1 }))).toBe("different_accounts");
    expect(await code(pocket.transfer({ fromPocketId: a, toPocketId: archived, amountCents: 100 }))).toBe("pocket_archived");
    expect(await code(pocket.transfer({ fromPocketId: a, toPocketId: archived, amountCents: 30001 }))).toBe("insufficient_pocket");
    expect((await repos.pocketMovements.list()).length).toBe(movementsBefore);
  });
});

describe("gastar com a reserva (spend)", () => {
  it("uso TOTAL: cria exatamente uma despesa, reduz saldo e reserva e o livre NÃO muda (sem dupla contagem)", async () => {
    const id = await newPocket({ initialCents: 30000 });
    const before = await money();
    const r = await pocket.spend({ pocketId: id, description: "Mercado", amountCents: 8000, categoryId: CAT });
    const after = await money();
    expect(after.txCount).toBe(before.txCount + 1);
    expect(after.balance).toBe(before.balance - 8000);
    expect(after.reserved).toBe(before.reserved - 8000);
    expect(after.free).toBe(before.free);
    expect(r).toMatchObject({ fromPocketCents: 8000, fromAccountCents: 0 });
    const expense = (await repos.transactions.list()).find((t) => t.id === r.transactionId)!;
    expect(expense).toMatchObject({ kind: "expense", status: "paid", amountCents: 8000, accountId: nubank.id, profileId: yan.id });
  });

  it("uso PARCIAL: a despesa sai inteira do saldo; só a parte usada sai da reserva", async () => {
    const id = await newPocket({ initialCents: 30000 });
    const before = await money();
    const r = await pocket.spend({ pocketId: id, description: "Padaria", amountCents: 5000, amountFromPocketCents: 3000, categoryId: CAT });
    const after = await money();
    expect(after.balance).toBe(before.balance - 5000);
    expect(after.reserved).toBe(before.reserved - 3000);
    expect(after.free).toBe(before.free - 2000);
    expect(r).toMatchObject({ fromPocketCents: 3000, fromAccountCents: 2000 });
  });

  it("recusas não deixam NADA para trás (atomicidade): valor da reserva, categoria, data, cofrinho sem saldo, lastro", async () => {
    const id = await newPocket({ initialCents: 7000 });
    const before = await money();
    expect(await code(pocket.spend({ pocketId: id, description: "x", amountCents: 2000, amountFromPocketCents: 5000, categoryId: CAT }))).toBe("amount_from_pocket_invalid");
    expect(await code(pocket.spend({ pocketId: id, description: "x", amountCents: 2000, amountFromPocketCents: 0, categoryId: CAT }))).toBe("amount_from_pocket_invalid");
    expect(await code(pocket.spend({ pocketId: id, description: "x", amountCents: 2000, categoryId: "" }))).toBe("category_required");
    expect(await code(pocket.spend({ pocketId: id, description: "x", amountCents: 0, categoryId: CAT }))).toBe("invalid_amount");
    expect(await code(pocket.spend({ pocketId: id, description: "x", amountCents: 2000, date: "2026-10-07", categoryId: CAT }))).toBe("future_date");
    expect(await code(pocket.spend({ pocketId: id, description: "x", amountCents: 20000, amountFromPocketCents: 7001, categoryId: CAT }))).toBe("insufficient_pocket");
    expect(await code(pocket.spend({ pocketId: id, description: "x", amountCents: 200000, amountFromPocketCents: 1000, categoryId: CAT }))).toBe("reserve_shortfall");
    const after = await money();
    expect([after.txCount, after.movementCount, after.balance, after.reserved]).toEqual([before.txCount, before.movementCount, before.balance, before.reserved]);
  });

  it("editar a despesa ligada reenviando os MESMOS valores financeiros passa (só mudar valor/data/conta/status bloqueia, como no banco)", async () => {
    const id = await newPocket({ initialCents: 30000 });
    const r = await pocket.spend({ pocketId: id, description: "Mercado", amountCents: 8000, categoryId: CAT });
    await load();
    const expense = current.transactions.find((t) => t.id === r.transactionId)!;
    await txs.update(expense, { description: "Mercado 2", amountCents: expense.amountCents, date: expense.date, status: expense.status, accountId: expense.accountId });
    expect((await repos.transactions.get(expense.id))!.description).toBe("Mercado 2");
    expect(await code(txs.update(expense, { amountCents: expense.amountCents + 1 }))).toBe("use_pocket_flow");
  });

  it("a despesa ligada não pode ser excluída nem ter valor/data/status/conta alterados; descrição segue editável", async () => {
    const id = await newPocket({ initialCents: 30000 });
    const r = await pocket.spend({ pocketId: id, description: "Mercado", amountCents: 8000, categoryId: CAT });
    await load();
    const expense = current.transactions.find((t) => t.id === r.transactionId)!;
    expect(await code(txs.delete(expense))).toBe("use_pocket_flow");
    expect(await code(txs.update(expense, { amountCents: 1 }))).toBe("use_pocket_flow");
    expect(await code(txs.update(expense, { accountId: santander.id }))).toBe("use_pocket_flow");
    expect(await code(txs.setStatus(expense, "pending"))).toBe("use_pocket_flow");
    await txs.update(expense, { description: "Mercado do mês", notes: "ok" });
    expect((await repos.transactions.get(expense.id))!.description).toBe("Mercado do mês");
  });
});

describe("estornar o uso (reverseUse)", () => {
  it("uso PARCIAL: cancela a despesa, a despesa INTEIRA volta ao saldo, só os 3000 usados voltam ao cofrinho; histórico preservado", async () => {
    const id = await newPocket({ initialCents: 30000 });
    const start = await money();
    const r = await pocket.spend({ pocketId: id, description: "Padaria", amountCents: 5000, amountFromPocketCents: 3000, categoryId: CAT });
    await pocket.reverseUse(r.transactionId, "desisti");
    const after = await money();
    expect(after.balance).toBe(start.balance);
    expect(after.pocketBalance(id)).toBe(30000);
    expect(after.free).toBe(start.free);
    const expense = (await repos.transactions.get(r.transactionId))!;
    expect(expense.status).toBe("canceled");
    const history = (await repos.pocketMovements.list()).filter((m) => m.transactionId === r.transactionId);
    expect(history.map((m) => m.kind).sort()).toEqual(["use", "use_reversal"]);
    const reversal = history.find((m) => m.kind === "use_reversal")!;
    expect(reversal).toMatchObject({ amountCents: 3000, note: "desisti" });
    expect(reversal.reversesId).toBe(history.find((m) => m.kind === "use")!.id);
  });

  it("uso TOTAL, estorno duplo, despesa sem uso, transação inexistente, cofrinho arquivado (reativar antes)", async () => {
    const id = await newPocket({ initialCents: 5000 });
    const r = await pocket.spend({ pocketId: id, description: "Tudo", amountCents: 5000, categoryId: CAT });
    await pocket.setArchived(id, true);
    expect(await code(pocket.reverseUse(r.transactionId))).toBe("pocket_archived");
    await pocket.setArchived(id, false);
    await pocket.reverseUse(r.transactionId);
    expect(await code(pocket.reverseUse(r.transactionId))).toBe("already_reversed");
    const plain = await txs.create({ kind: "expense", description: "Sem reserva", amountCents: 100, date: TODAY, status: "paid", paidAt: TODAY, tags: [], profileId: yan.id, accountId: nubank.id, categoryId: CAT });
    expect(await code(pocket.reverseUse(plain))).toBe("no_pocket_use");
    expect(await code(pocket.reverseUse("nao-existe"))).toBe("transaction_not_found");
    // depois do estorno a despesa fica travada (não volta a "paga")
    await load();
    const expense = current.transactions.find((t) => t.id === r.transactionId)!;
    expect(await code(txs.setStatus(expense, "paid"))).toBe("use_pocket_flow");
  });
});

describe("lastro: nenhuma operação deixa reserva sem saldo (e nada é liberado automaticamente)", () => {
  const expense = (cents: number, over = {}) => ({ kind: "expense" as const, description: "x", amountCents: cents, date: TODAY, status: "paid" as const, paidAt: TODAY, tags: [], profileId: yan.id, accountId: nubank.id, categoryId: CAT, ...over });

  it("despesa paga acima do livre: reserve_shortfall com o valor que falta; depois de liberar, a MESMA operação passa", async () => {
    const id = await newPocket({ initialCents: 60000 }); // livre = 40000
    const msg = await message(txs.create(expense(40001)));
    expect(msg).toContain("R$ 0,01");
    expect(await code(txs.create(expense(40001)))).toBe("reserve_shortfall");
    await txs.create(expense(40000)); // exatamente o livre
    expect(await code(txs.create(expense(1)))).toBe("reserve_shortfall");
    expect((await money()).pocketBalance(id)).toBe(60000); // a reserva NÃO foi tocada
    await pocket.withdraw({ pocketId: id, amountCents: 100 }); // o usuário libera
    await txs.create(expense(100)); // repetir passa
  });

  it("receita nunca é bloqueada; reduzir/excluir/despagar receita paga é bloqueado só se deixar reserva sem lastro", async () => {
    await newPocket({ initialCents: 100000 });
    const income = await txs.create({ ...expense(20000), kind: "income" });
    await txs.create({ ...expense(5000), kind: "income" }); // melhora: ok
    await txs.create(expense(25000)); // consome toda a folga criada pelas receitas
    await load();
    const inc = current.transactions.find((t) => t.id === income)!;
    expect(await code(txs.update(inc, { amountCents: 1 }))).toBe("reserve_shortfall");
    expect(await code(txs.setStatus(inc, "pending"))).toBe("reserve_shortfall");
    expect(await code(txs.delete(inc))).toBe("reserve_shortfall");
  });

  it("transferência de saída, pagamento de dívida e pagamento de fatura também respeitam o lastro", async () => {
    await newPocket({ initialCents: 100000 }); // livre = 0
    expect(await code(txs.create({ ...expense(1), kind: "transfer", accountId: nubank.id, toAccountId: santander.id, categoryId: undefined }))).toBe("reserve_shortfall");
    const debtId = await debts.create({ name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 50000, totalCents: 50000 });
    expect(await code(debts.pay({ debtId, accountId: nubank.id, amountCents: 1000, date: TODAY }))).toBe("reserve_shortfall");
    await repos.transactions.create({ kind: "credit_card_purchase", description: "Compra", amountCents: 5000, date: "2026-10-03", status: "pending", cardId: card.id, tags: [], profileId: yan.id, categoryId: CAT });
    await load();
    expect(await code(txs.payInvoice({ cardId: card.id, dueMonth: "2026-10", accountId: nubank.id, amountCents: 5000, date: TODAY }))).toBe("reserve_shortfall");
  });

  it("conta SEM reserva nunca é verificada: ir ao vermelho continua permitido", async () => {
    await newPocket({ accountId: santander.id, initialCents: 100000 }); // reserva na Santander
    await txs.create(expense(500000)); // Nubank sem reserva: vai ao negativo e tudo bem
    expect((await money(nubank.id)).balance).toBe(100000 - 500000);
  });
});

describe("arquivar e reativar", () => {
  it("arquivar exige saldo 0; reativar exige conta ativa (e de consumo)", async () => {
    const id = await newPocket({ initialCents: 1000 });
    expect(await code(pocket.setArchived(id, true))).toBe("pocket_has_balance");
    await pocket.withdraw({ pocketId: id, amountCents: 1000 });
    await pocket.setArchived(id, true);
    await repos.accounts.update(nubank.id, { active: false });
    expect(await code(pocket.setArchived(id, false))).toBe("account_not_allowed");
    await repos.accounts.update(nubank.id, { active: true });
    await pocket.setArchived(id, false);
    expect((await repos.pockets.get(id))!.status).toBe("active");
  });

  it("update: nome/descrição/ícone/cor/responsável; conta é imutável (não existe no patch)", async () => {
    const id = await newPocket();
    await pocket.update(id, { name: "Viagem Inglaterra", description: "x", color: "#112233", icon: "plane", profileId: casal.id });
    expect(await repos.pockets.get(id)).toMatchObject({ name: "Viagem Inglaterra", description: "x", color: "#112233", icon: "plane", profileId: casal.id, accountId: nubank.id });
    expect(await code(pocket.update(id, { name: "" }))).toBe("pockets_name_check");
    expect(await code(pocket.update(id, { profileId: "x" }))).toBe("profile_not_found");
  });
});

describe("objetivos", () => {
  const goal = (over: Partial<Goal> = {}): Omit<Goal, "id"> => ({ name: "Meta", kind: "travel", targetCents: 100000, profileId: yan.id, icon: "target", color: "#4f46e5", status: "active", manualAmountCents: 0, ...over });

  it("manual: progresso = valor informado; não é dinheiro reservado (não entra no reservado nem no livre)", async () => {
    const g = await repos.goals.create(goal({ manualAmountCents: 25000 }));
    const m = await money();
    expect(m.reserved).toBe(0);
    expect(m.free).toBe(100000);
    const progress = goalProgress(g, new Map());
    expect(progress).toMatchObject({ source: "manual", currentCents: 25000, remainingCents: 75000, percent: 25, reached: false });
  });

  it("ligado: progresso = saldo REAL do cofrinho; ligar zera o manual e desligar NÃO o restaura; um cofrinho por objetivo", async () => {
    const id = await newPocket({ initialCents: 33333 });
    const g1 = await repos.goals.create(goal({ manualAmountCents: 5000 }));
    const g2 = await repos.goals.create(goal({ name: "Outra" }));
    await pocket.linkGoal(g1.id, id);
    expect(await repos.goals.get(g1.id)).toMatchObject({ pocketId: id, manualAmountCents: 0 });
    expect(await code(pocket.linkGoal(g2.id, id))).toBe("pocket_already_linked");
    expect(await code(pocket.linkGoal(g2.id, "nao-existe"))).toBe("pocket_not_found");
    expect(await code(pocket.linkGoal("nao-existe", id))).toBe("goal_not_found");
    const data = await load();
    const progress = goalProgress((await repos.goals.get(g1.id))!, snapshotOf(data, TODAY).pocketBalances);
    expect(progress).toMatchObject({ source: "pocket", currentCents: 33333, remainingCents: 66667, percent: 33.33 });
    await pocket.linkGoal(g1.id, null);
    const unlinked = (await repos.goals.get(g1.id))!;
    expect(unlinked.pocketId ?? undefined).toBeUndefined();
    expect(unlinked.manualAmountCents).toBe(0);
  });

  it("o progresso acompanha o cofrinho: gastar com a reserva reduz o progresso; estornar devolve", async () => {
    const id = await newPocket({ initialCents: 30000 });
    const g = await repos.goals.create(goal({ pocketId: id }));
    const r = await pocket.spend({ pocketId: id, description: "x", amountCents: 10000, categoryId: CAT });
    const progressOf = async () => goalProgress((await repos.goals.get(g.id))!, snapshotOf(await load(), TODAY).pocketBalances).currentCents;
    expect(await progressOf()).toBe(20000);
    await pocket.reverseUse(r.transactionId);
    expect(await progressOf()).toBe(30000);
  });
});

describe("Disponível de verdade usa o reservado derivado do histórico (sem dupla contagem)", () => {
  it("reservar reduz o disponível; gastar com a reserva inteira NÃO o reduz de novo; estornar volta ao mesmo valor", async () => {
    const id = await newPocket();
    const availableOf = async () => {
      const data = await load();
      return buildDashboard({ ...data, profiles: [yan, camila, casal], categories: [] }, { profileId: ALL_PROFILES, month: "2026-10" }, "Yan", TODAY).availableBreakdown;
    };
    const base = await availableOf();
    await pocket.reserve({ pocketId: id, amountCents: 30000 });
    const reserved = await availableOf();
    expect(reserved.reservedCents).toBe(30000);
    expect(reserved.availableCents).toBe(base.availableCents - 30000);
    const r = await pocket.spend({ pocketId: id, description: "x", amountCents: 8000, categoryId: CAT });
    const spent = await availableOf();
    expect(spent.availableCents).toBe(reserved.availableCents); // saldo −8000 e reservado −8000: o disponível não muda
    expect(spent.reservedCents).toBe(22000);
    await pocket.reverseUse(r.transactionId);
    expect((await availableOf()).availableCents).toBe(reserved.availableCents);
    await pocket.withdraw({ pocketId: id, amountCents: 30000 });
    expect((await availableOf()).availableCents).toBe(base.availableCents); // retirar devolve o livre
  });
});

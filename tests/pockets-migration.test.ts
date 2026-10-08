import { beforeEach, describe, expect, it } from "vitest";
import { snapshotOf, snapshotPocketBalance, snapshotReserved } from "@/domain/snapshot";
import { LocalPocketCommands } from "@/services/local-pocket";
import {
  LEGACY_LOCAL_POCKETS_KEY,
  legacyRefOf,
  migrateLegacyPockets,
  prepareLocalPockets,
  readLegacyPockets,
} from "@/services/pocket-migration";
import { createRepos, installFakeStorage, invest, camila, casal, mercadoPago, nubank, santander, TODAY, workspace, yan } from "./helpers";

let store: Map<string, string>;
let repos: ReturnType<typeof createRepos>;
let commands: LocalPocketCommands;

const deps = () => ({ commands, accounts: repos.accounts, pockets: repos.pockets });
const writeLegacy = (items: unknown[]) => store.set(LEGACY_LOCAL_POCKETS_KEY, JSON.stringify(items));

beforeEach(() => {
  store = installFakeStorage();
  repos = createRepos({ accounts: [nubank, mercadoPago, santander, invest], profiles: [yan, camila, casal] });
  commands = new LocalPocketCommands(
    { pockets: repos.pockets, pocketMovements: repos.pocketMovements, goals: repos.goals, accounts: repos.accounts, profiles: repos.profiles, transactions: repos.transactions },
    { today: () => TODAY },
  );
});

const balances = async () => {
  const data = workspace({ accounts: await repos.accounts.list(), pockets: await repos.pockets.list(), pocketMovements: await repos.pocketMovements.list() });
  const snap = snapshotOf(data, TODAY);
  return { of: (id: string) => snapshotPocketBalance(snap, { id }), reserved: (accountId: string) => snapshotReserved(snap, accountId) };
};

describe("migração dos cofrinhos antigos", () => {
  it("lê só o formato antigo (ignora lixo e o formato novo)", () => {
    writeLegacy([{ id: "k1", name: "A", accountId: nubank.id, amountCents: 100 }, { id: "x" }, { id: "n", name: "N", accountId: "a", amountCents: 1, profileId: "p" }, null]);
    expect(readLegacyPockets(LEGACY_LOCAL_POCKETS_KEY).map((p) => p.id)).toEqual(["k1"]);
    store.set(LEGACY_LOCAL_POCKETS_KEY, "{lixo");
    expect(readLegacyPockets(LEGACY_LOCAL_POCKETS_KEY)).toEqual([]);
  });

  it("cada cofrinho vira cofrinho + reserva inicial (saldo derivado), dono = dono da conta", async () => {
    const report = await migrateLegacyPockets(
      [{ id: "k1", name: "Emergência", accountId: nubank.id, amountCents: 30000 }, { id: "k2", name: "Viagem", accountId: santander.id, amountCents: 10000 }],
      deps(),
    );
    expect(report).toMatchObject({ imported: 2, alreadyImported: 0, withoutReserve: [], failed: [] });
    const pockets = await repos.pockets.list();
    expect(pockets.map((p) => [p.name, p.profileId, p.legacyRef])).toEqual([
      ["Emergência", yan.id, legacyRefOf("k1")],
      ["Viagem", camila.id, legacyRefOf("k2")],
    ]);
    const b = await balances();
    expect(b.of(pockets[0].id)).toBe(30000);
    expect(b.reserved(nubank.id)).toBe(30000);
    const movements = await repos.pocketMovements.list();
    expect(movements.map((m) => m.kind)).toEqual(["reserve", "reserve"]);
  });

  it("IDEMPOTENTE: rodar de novo não duplica cofrinho nem reserva", async () => {
    const legacy = [{ id: "k1", name: "Emergência", accountId: nubank.id, amountCents: 30000 }];
    await migrateLegacyPockets(legacy, deps());
    const again = await migrateLegacyPockets(legacy, deps());
    expect(again).toMatchObject({ imported: 0, alreadyImported: 1 });
    expect((await repos.pockets.list()).length).toBe(1);
    expect((await repos.pocketMovements.list()).length).toBe(1);
    expect((await balances()).reserved(nubank.id)).toBe(30000);
  });

  it("respeita o lastro: o que não cabe no livre vira cofrinho SEM reserva + aviso (nada de reserva fictícia)", async () => {
    // Nubank tem R$ 1.000,00: o primeiro cabe, o segundo passaria do livre.
    const report = await migrateLegacyPockets(
      [{ id: "k1", name: "Cabe", accountId: nubank.id, amountCents: 80000 }, { id: "k2", name: "Não cabe", accountId: nubank.id, amountCents: 50000 }],
      deps(),
    );
    expect(report.imported).toBe(1);
    expect(report.withoutReserve).toHaveLength(1);
    expect(report.withoutReserve[0]).toMatchObject({ name: "Não cabe", amountCents: 50000 });
    expect(report.withoutReserve[0].reason).toContain("livre");
    const pockets = await repos.pockets.list();
    const b = await balances();
    expect(pockets.map((p) => b.of(p.id))).toEqual([80000, 0]);
    expect(b.reserved(nubank.id)).toBe(80000);
    // e rodar de novo NÃO tenta de novo nem duplica
    const again = await migrateLegacyPockets([{ id: "k2", name: "Não cabe", accountId: nubank.id, amountCents: 50000 }], deps());
    expect(again.alreadyImported).toBe(1);
  });

  it("conta inexistente ou de investimento: não importa e informa; valor 0 vira cofrinho vazio", async () => {
    const report = await migrateLegacyPockets(
      [{ id: "k1", name: "Órfão", accountId: "sumiu", amountCents: 100 }, { id: "k2", name: "Invest", accountId: invest.id, amountCents: 100 }, { id: "k3", name: "Vazio", accountId: nubank.id, amountCents: 0 }],
      deps(),
    );
    expect(report.failed.map((f) => f.name)).toEqual(["Órfão", "Invest"]);
    expect(report.imported).toBe(1);
    expect((await repos.pockets.list()).map((p) => p.name)).toEqual(["Vazio"]);
  });

  it("prepareLocalPockets NÃO importa nada sozinho: só inicia o armazenamento novo vazio e a chave antiga fica intacta", async () => {
    writeLegacy([{ id: "k1", name: "Emergência", accountId: nubank.id, amountCents: 30000 }]);
    const before = store.get(LEGACY_LOCAL_POCKETS_KEY);
    let resets = 0;
    prepareLocalPockets(() => void resets++);
    expect(resets).toBe(1); // novo ainda não existe: começa vazio (sem semear a demonstração por cima)
    expect(store.get(LEGACY_LOCAL_POCKETS_KEY)).toBe(before);
    expect(await repos.pockets.list()).toEqual([]); // nada importado sem ação do usuário
    expect(await repos.pocketMovements.list()).toEqual([]);
  });

  it("prepareLocalPockets: sem cofrinhos antigos, ou com o armazenamento novo já criado, não zera nada", async () => {
    prepareLocalPockets(() => {
      throw new Error("não deveria zerar");
    });
    writeLegacy([{ id: "k1", name: "A", accountId: nubank.id, amountCents: 1 }]);
    await repos.pockets.list(); // cria a chave nova
    prepareLocalPockets(() => {
      throw new Error("não deveria zerar");
    });
  });

  it("importar depois da ação do usuário: idempotente mesmo repetindo o clique", async () => {
    writeLegacy([{ id: "k1", name: "Emergência", accountId: nubank.id, amountCents: 30000 }]);
    const first = await migrateLegacyPockets(readLegacyPockets(LEGACY_LOCAL_POCKETS_KEY), deps());
    const second = await migrateLegacyPockets(readLegacyPockets(LEGACY_LOCAL_POCKETS_KEY), deps());
    expect([first.imported, second.imported, second.alreadyImported]).toEqual([1, 0, 1]);
    expect((await repos.pocketMovements.list()).length).toBe(1);
    expect(store.get(LEGACY_LOCAL_POCKETS_KEY)).toBeDefined();
  });
});

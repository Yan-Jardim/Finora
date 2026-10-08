import { beforeEach, describe, expect, it } from "vitest";
import { LocalAccountRepository } from "@/repositories/local-account-repository";
import { AppError } from "@/repositories/supabase/errors";
import { LocalPocketCommands } from "@/services/local-pocket";
import { createRepos, installFakeStorage, invest, camila, casal, mercadoPago, nubank, santander, TODAY, yan } from "./helpers";

let repos: ReturnType<typeof createRepos>;
let accounts: LocalAccountRepository;
let pocket: LocalPocketCommands;

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  return "SEM_ERRO";
};

beforeEach(() => {
  installFakeStorage();
  repos = createRepos({ accounts: [nubank, mercadoPago, santander, invest], profiles: [yan, camila, casal] });
  // As contas locais do app: mesma chave, com as guardas de lastro.
  accounts = new LocalAccountRepository("accounts", () => [], () => ({ pockets: repos.pockets, pocketMovements: repos.pocketMovements, transactions: repos.transactions }));
  pocket = new LocalPocketCommands(
    { pockets: repos.pockets, pocketMovements: repos.pocketMovements, goals: repos.goals, accounts: repos.accounts, profiles: repos.profiles, transactions: repos.transactions },
    { today: () => TODAY },
  );
});

describe("edição de conta no modo local respeita o lastro do banco", () => {
  const withReserve = () => pocket.create({ name: "Reserva", profileId: yan.id, accountId: nubank.id, initialCents: 60000 }); // saldo 100.000, livre 40.000

  it("reduzir o saldo inicial: só até a folga; além disso, reserve_shortfall com o que falta", async () => {
    await withReserve();
    expect(await code(accounts.update(nubank.id, { initialBalanceCents: 100000 - 40001 }))).toBe("reserve_shortfall");
    expect((await accounts.get(nubank.id))!.initialBalanceCents).toBe(100000);
    await accounts.update(nubank.id, { initialBalanceCents: 100000 - 40000 }); // exatamente a folga
    await accounts.update(nubank.id, { initialBalanceCents: 500000 }); // aumentar nunca é bloqueado
  });

  it("arquivar (desativar) ou virar investimento com reserva: account_has_reserve; com a reserva retirada, passa", async () => {
    const id = await withReserve();
    expect(await code(accounts.update(nubank.id, { active: false }))).toBe("account_has_reserve");
    expect(await code(accounts.update(nubank.id, { type: "investment" }))).toBe("account_has_reserve");
    await pocket.withdraw({ pocketId: id, amountCents: 60000 });
    await accounts.update(nubank.id, { type: "investment" });
    await accounts.update(nubank.id, { active: false });
  });

  it("outras edições (nome, cor, incluir no patrimônio) nunca são bloqueadas", async () => {
    await withReserve();
    await accounts.update(nubank.id, { name: "Nubank Principal", color: "#112233", includeInNetWorth: false });
    expect((await accounts.get(nubank.id))!.name).toBe("Nubank Principal");
  });

  it("conta SEM reserva nunca é verificada: pode ir ao vermelho e ser desativada", async () => {
    await withReserve();
    await accounts.update(mercadoPago.id, { initialBalanceCents: -50000 });
    await accounts.update(mercadoPago.id, { active: false });
  });

  it("excluir conta que tem cofrinho: bloqueado (como a FK do banco); sem cofrinho, exclui", async () => {
    await withReserve();
    expect(await code(accounts.remove(nubank.id))).toBeUndefined(); // erro "em uso" traduzido (sem código de regra)
    expect((await accounts.get(nubank.id))!.id).toBe(nubank.id);
    await accounts.remove(mercadoPago.id);
    expect(await accounts.get(mercadoPago.id)).toBeUndefined();
  });
});

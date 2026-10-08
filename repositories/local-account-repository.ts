import { accountBalance } from "@/domain/calculations";
import { accountReservedOf } from "@/domain/pockets";
import type { Account, Pocket, PocketMovement, Transaction } from "@/domain/types";
import { appError, toFriendlyError } from "./supabase/errors";
import { LocalStorageRepository } from "./local-storage-repository";
import type { Repository } from "./types";

/** Leituras que as guardas precisam (resolvidas na hora: os armazenamentos de cofrinhos são criados depois deste). */
export interface AccountGuardSources {
  pockets: Pick<Repository<Pocket>, "list">;
  pocketMovements: Pick<Repository<PocketMovement>, "list">;
  transactions: Pick<Repository<Transaction>, "list">;
}

/**
 * Contas do modo LOCAL com as mesmas guardas de lastro do banco (trigger z_reserve_backing em accounts):
 *  - desativar ou virar investimento com dinheiro reservado → account_has_reserve;
 *  - reduzir o saldo inicial (ou qualquer edição que deixe saldo < reservado) → reserve_shortfall;
 *  - excluir conta que tem cofrinhos → "em uso" (no banco, a FK impede).
 * Conta SEM reserva nunca é verificada. Melhorar o saldo nunca é bloqueado.
 */
export class LocalAccountRepository extends LocalStorageRepository<Account> {
  constructor(
    name: string,
    seed: () => Account[],
    private readonly sources: () => AccountGuardSources,
  ) {
    super(name, seed);
  }

  override async update(id: string, patch: Partial<Omit<Account, "id">>) {
    const current = await this.get(id);
    if (current) await this.assertEditable(current, { ...current, ...patch });
    return super.update(id, patch);
  }

  override async remove(id: string) {
    const { pockets } = this.sources();
    if ((await pockets.list()).some((p) => p.accountId === id)) {
      throw toFriendlyError({ code: "23503", message: "update or delete on table accounts violates foreign key" });
    }
    return super.remove(id);
  }

  override async removeMany(ids: string[]) {
    for (const id of ids) await this.remove(id);
  }

  private async assertEditable(before: Account, after: Account) {
    const { pockets, pocketMovements, transactions } = this.sources();
    const [pocketList, movements] = await Promise.all([pockets.list(), pocketMovements.list()]);
    const reserved = accountReservedOf(pocketList, movements, before.id);
    if (reserved <= 0) return; // sem reserva: nada a proteger (saldo negativo continua permitido)

    const deactivates = before.active && !after.active;
    const becomesInvestment = after.type === "investment" && before.type !== "investment";
    if (deactivates || becomesInvestment) throw appError("account_has_reserve", { account_id: before.id });

    if (after.initialBalanceCents < before.initialBalanceCents) {
      const all = await transactions.list();
      const balance = accountBalance(after, all);
      if (balance < reserved) {
        throw appError("reserve_shortfall", { account_id: before.id, shortfall_cents: reserved - balance, reserved_cents: reserved, balance_cents: balance });
      }
    }
  }
}

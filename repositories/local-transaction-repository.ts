import type { Transaction } from "@/domain/types";
import { LocalStorageRepository } from "./local-storage-repository";
import type { TransactionQueryResult, TransactionRepository, TransactionWindow } from "./types";

/**
 * Movimentações em localStorage (modo local/demo e testes). Mantém o contrato completo de escrita
 * (`LocalStorageRepository`) — usado pelo motor local — e acrescenta `query`, que aqui ignora a janela:
 * tudo já está em memória e as telas filtram por mês.
 */
export class LocalTransactionRepository extends LocalStorageRepository<Transaction> implements TransactionRepository {
  async query(_window: TransactionWindow): Promise<TransactionQueryResult> {
    void _window;
    return { items: await this.list(), truncated: false };
  }
}

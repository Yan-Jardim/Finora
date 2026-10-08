import type { Cents, ID, ISODate } from "@/domain/types";

/**
 * PORTA de comandos de COFRINHOS. Os componentes só conhecem esta interface:
 *
 * - LocalPocketCommands ........ motor em localStorage (demo/testes): services/local-pocket.ts;
 * - SupabasePocketCommands ..... RPCs atômicas: create_pocket, update_pocket, set_pocket_archived, pocket_reserve,
 *   pocket_withdraw, pocket_transfer, spend_from_pocket, reverse_pocket_use, link_goal_pocket.
 *
 * Semântica (igual nos dois motores):
 *  - RESERVAR: alocação virtual. Não altera o saldo bancário, não cria despesa e REDUZ o dinheiro livre da conta.
 *    Nunca além do livre (saldo − reservado).
 *  - RETIRAR: não altera o saldo bancário e AUMENTA o livre. Nunca além do saldo do cofrinho.
 *  - TRANSFERIR entre cofrinhos (da MESMA conta): não altera saldo nem o reservado total da conta.
 *  - GASTAR (spend): cria exatamente UMA despesa paga na conta do cofrinho e usa a reserva (total ou PARCIAL). Reduz o
 *    saldo bancário (despesa inteira) e a reserva (só a parte usada); o livre não muda quando a reserva cobre tudo.
 *  - ESTORNAR (reverseUse): cancela a despesa (o saldo bancário volta inteiro) e devolve ao cofrinho SÓ o que o uso tirou;
 *    o histórico (uso, estorno e despesa cancelada) é preservado.
 *  - LASTRO: reservado > 0 => saldo >= reservado. Qualquer operação que violaria isso é recusada com `reserve_shortfall`
 *    (com o valor que falta); NADA é alterado automaticamente. Contas SEM reserva nunca são verificadas.
 *  - Objetivo ligado a cofrinho: progresso = saldo real do cofrinho. Ao LIGAR, o valor manual do objetivo vira 0 e NÃO é
 *    restaurado ao desligar (a interface deve avisar antes). Objetivo manual nunca é dinheiro reservado.
 *
 * Erros: sempre `AppError` com mensagem pronta e `code` estável (repositories/supabase/errors.ts).
 */

export interface PocketInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  /** Responsável (pessoa ou Casal). */
  profileId: ID;
  /** Conta de consumo ativa onde o dinheiro está. Imutável depois de criado. */
  accountId: ID;
  /** Reserva inicial opcional (respeita o livre da conta). */
  initialCents?: Cents;
  date?: ISODate;
  /** Idempotência da importação dos cofrinhos antigos: o mesmo valor devolve o cofrinho já criado. */
  legacyRef?: string;
}

export type PocketPatch = Partial<Pick<PocketInput, "name" | "description" | "icon" | "color" | "profileId">>;

export interface PocketAmountInput {
  pocketId: ID;
  amountCents: Cents;
  /** Padrão: hoje (fuso do household no Supabase). Nunca no futuro. */
  date?: ISODate;
  note?: string;
}

export interface PocketTransferInput {
  fromPocketId: ID;
  toPocketId: ID;
  amountCents: Cents;
  date?: ISODate;
  note?: string;
}

export interface PocketSpendInput {
  pocketId: ID;
  description: string;
  /** Valor da despesa (sai inteiro do saldo bancário). */
  amountCents: Cents;
  /** Quanto da reserva cobre (padrão: tudo; 0 < x <= amountCents). */
  amountFromPocketCents?: Cents;
  date?: ISODate;
  categoryId: ID;
  /** Padrão: o responsável do cofrinho. */
  profileId?: ID;
  notes?: string;
  tags?: string[];
}

export interface PocketSpendResult {
  transactionId: ID;
  movementId: ID;
  fromPocketCents: Cents;
  fromAccountCents: Cents;
}

export interface PocketCommands {
  create(input: PocketInput): Promise<ID>;
  update(pocketId: ID, patch: PocketPatch): Promise<void>;
  /** Arquivar exige saldo 0; reativar exige conta ativa. */
  setArchived(pocketId: ID, archived: boolean): Promise<void>;
  reserve(input: PocketAmountInput): Promise<ID>;
  withdraw(input: PocketAmountInput): Promise<ID>;
  /** Devolve o transfer_group_id. */
  transfer(input: PocketTransferInput): Promise<ID>;
  spend(input: PocketSpendInput): Promise<PocketSpendResult>;
  /** Devolve o id do movimento de estorno. */
  reverseUse(transactionId: ID, note?: string): Promise<ID>;
  /** `null` desliga. Ligar zera o valor manual do objetivo (não restaurado ao desligar). */
  linkGoal(goalId: ID, pocketId: ID | null): Promise<void>;
}

export interface PocketContext {
  /** "Hoje": navegador (local) ou fuso do household (supabase). */
  today(): ISODate;
}

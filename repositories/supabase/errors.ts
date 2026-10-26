/**
 * CAMADA CENTRAL de tradução de erros do banco (Postgres/PostgREST) para mensagens ao usuário.
 *
 * Fontes de erro cobertas:
 *  - códigos de domínio que NOSSAS funções/triggers levantam (`raise exception 'invoice_paid_locked'`);
 *  - constraints nomeadas (unicidade e CHECKs de formato);
 *  - SQLSTATE genéricos (permissão, FK, rede, sessão).
 * O usuário nunca vê código cru do Postgres. O erro original fica em `error.cause` e, fora de produção, é logado
 * no console para diagnóstico (nunca com dados sensíveis: só código/mensagem do banco).
 */
import { formatMoney } from "@/lib/format";

export interface DbErrorLike {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

const UNIQUE_BY_CONSTRAINT: Record<string, string> = {
  categories_household_parent_name_key: "Já existe uma categoria com esse nome neste nível.",
  accounts_household_name_key: "Já existe uma conta com esse nome.",
  credit_cards_household_name_key: "Já existe um cartão com esse nome.",
  financial_profiles_household_name_key: "Já existe uma pessoa com esse nome.",
  transactions_installment_key: "Esta parcela já existe nesta compra.",
  transactions_recurring_occurrence_key: "Esta ocorrência da recorrência já existe.",
  bank_connections_item_key: "Este banco (Item ID) já está conectado.",
};

const CHECK_BY_CONSTRAINT: Record<string, string> = {
  transactions_installment_only_card_purchase: "Parcelas só existem em compras no cartão de crédito.",
  transactions_kind_shape: "Os campos informados não combinam com o tipo da movimentação (conta, cartão e categoria).",
  transactions_paid_consistency: "O status e a data de pagamento não são compatíveis. Compras no cartão são quitadas pelo pagamento da fatura.",
  transactions_installment_pair: "Parcela inconsistente com a compra original.",
  debts_total_not_below_principal: "O total a pagar não pode ser menor que o valor original.",
  transactions_debt_payment_only: "Pagamento de dívida é sempre uma saída já paga.",
  recurring_transactions_kind_shape: "Receita e despesa usam conta; compra no cartão usa só o cartão.",
  recurring_transactions_date_range: "A data final não pode ser anterior à data inicial.",
  pockets_name_check: "O nome do cofrinho deve ter entre 1 e 60 caracteres.",
  goals_manual_xor_pocket: "Um objetivo ligado a um cofrinho não tem valor informado à mão.",
  bank_connections_item_id_check: "Item ID inválido. Copie o ID da conexão no Dashboard da Pluggy.",
  bank_connections_credential_key_check: "Credencial inválida. Escolha uma das credenciais configuradas.",
};

/** Códigos de domínio das nossas funções e triggers (texto da exceção). */
const RULE_CODES: Record<string, string> = {
  // categorias
  category_parent_must_be_root: "Só é possível um nível de subcategoria.",
  category_kind_incompatible: "O tipo da subcategoria precisa ser compatível com o da categoria pai.",
  category_has_children: "Esta categoria possui subcategorias e não pode virar subcategoria.",
  category_parent_not_found: "A categoria pai não existe neste espaço.",
  // movimentações
  category_kind_mismatch: "A categoria escolhida não combina com o tipo da movimentação (receita x despesa).",
  transaction_not_found: "Movimentação não encontrada.",
  transaction_kind_immutable: "O tipo da movimentação não pode ser alterado.",
  status_required: "Informe o status da movimentação.",
  invalid_paid_at: "A data de pagamento só se aplica a movimentações pagas.",
  invalid_date: "Informe uma data válida.",
  invalid_amount: "Informe um valor maior que zero.",
  invalid_split: "Não foi possível dividir o valor entre as parcelas.",
  // parcelas
  invalid_installments: "O número de parcelas deve ficar entre 2 e 48.",
  not_an_installment: "Esta movimentação não faz parte de uma compra parcelada.",
  installment_card_mismatch: "A parcela precisa ser do mesmo cartão da compra original.",
  installment_number_out_of_range: "O número da parcela está fora do total da compra.",
  invalid_scope: "Escopo inválido para esta operação.",
  invalid_patch_key: "Este campo não pode ser alterado nesta operação.",
  use_update_installments: "Esta movimentação é uma parcela: edite pelas opções de parcelamento.",
  // recorrências
  recurring_not_found: "Recorrência não encontrada.",
  invalid_interval: "O intervalo deve ficar entre 1 e 24.",
  invalid_date_range: "A data final não pode ser anterior à data inicial.",
  invalid_recurring_kind: "Este tipo de movimentação não pode ser recorrente.",
  recurrence_link_immutable: "O vínculo da ocorrência com a recorrência não pode ser alterado.",
  // dívidas
  debt_not_found: "Dívida não encontrada.",
  debt_canceled: "Esta dívida está cancelada.",
  debt_settled_locked: "Esta dívida foi quitada e não pode ser alterada. Reabra a dívida antes.",
  debt_already_paid: "Esta dívida já está totalmente paga.",
  debt_not_settled: "Esta dívida não foi quitada por acordo.",
  debt_has_payments: "Esta dívida já tem pagamentos: quite ou pause em vez de cancelar.",
  debt_overpaid: "Os pagamentos não podem ultrapassar o total da dívida.",
  payment_exceeds_remaining: "O pagamento não pode ser maior que o saldo devido da dívida.",
  total_below_paid: "O total não pode ficar abaixo do que já foi pago.",
  use_debt_flow: "Pagamento de dívida só muda pela tela de Dívidas. Exclua o pagamento para desfazê-lo.",
  // faturas e cartões
  invoice_paid_locked: "Esta fatura já está paga e não pode ser alterada.",
  invoice_overpaid: "A operação deixaria a fatura com mais pagamentos do que compras. Ajuste o pagamento antes.",
  payment_exceeds_open: "O pagamento não pode ser maior que o valor em aberto da fatura.",
  payment_invoice_mismatch: "A fatura informada não pertence a este cartão.",
  invoice_not_found: "Esta fatura não existe ou não possui valor em aberto.",
  card_not_found: "Cartão não encontrado.",
  use_pay_invoice: "Pagamentos de fatura são registrados em \"Pagar fatura\".",
  use_pay_invoice_flow: "Pagamento de fatura não é editado aqui: exclua o pagamento e registre outro.",
  // pessoas e espaço
  profile_not_found: "Pessoa não encontrada.",
  // cofrinhos e objetivos (os de valor — reserve_shortfall, insufficient_free, insufficient_pocket — estão em DYNAMIC_RULES)
  pocket_not_found: "Cofrinho não encontrado.",
  goal_not_found: "Objetivo não encontrado.",
  pocket_has_balance: "Retire o dinheiro reservado antes de arquivar o cofrinho.",
  pocket_archived: "Este cofrinho está arquivado. Reative-o para movimentar.",
  pocket_account_immutable: "A conta de um cofrinho não pode ser alterada.",
  account_has_reserve: "Esta conta tem dinheiro reservado em cofrinhos. Retire as reservas antes de desativá-la ou mudar o tipo.",
  account_not_allowed: "Cofrinhos só ficam em contas de consumo ativas (não em contas de investimento).",
  different_accounts: "Só é possível transferir reserva entre cofrinhos da mesma conta. Para mudar de banco, faça antes a transferência bancária.",
  same_pocket: "Escolha dois cofrinhos diferentes.",
  use_pocket_flow: "Esta despesa usou dinheiro de um cofrinho: para desfazê-la use \"Estornar\" (o histórico é preservado).",
  amount_from_pocket_invalid: "O valor tirado do cofrinho deve ser maior que zero e não pode passar do valor da despesa.",
  no_pocket_use: "Esta despesa não usou dinheiro de um cofrinho.",
  already_reversed: "Este uso do cofrinho já foi estornado.",
  pocket_already_linked: "Este cofrinho já está ligado a outro objetivo.",
  category_required: "Escolha a categoria da despesa.",
  future_date: "A data não pode ser futura.",
  use_invalid_expense: "A despesa precisa estar paga e ser da mesma conta do cofrinho.",
  reversal_invalid: "Estorno inválido para este uso do cofrinho.",
  use_inconsistent: "A despesa e o uso do cofrinho ficaram inconsistentes. Nada foi alterado.",
  transfer_unbalanced: "A transferência entre cofrinhos precisa ter as duas pontas iguais. Nada foi alterado.",
  pocket_history_immutable: "O histórico de um cofrinho não pode ser alterado.",
  // Open Finance
  bank_connection_not_found: "Conexão bancária não encontrada.",
  invalid_bank_accounts: "O banco devolveu dados em formato inesperado. Nada foi alterado.",
  // acesso
  forbidden: "Você não tem permissão para esta ação.",
  not_authenticated: "Sua sessão expirou. Entre novamente.",
};

const hasWord = (text: string, word: string) => new RegExp(`\\b${word}\\b`).test(text);

/** "chave=valor;chave=valor" (o DETAIL das nossas exceções) -> objeto. */
export function parseDetails(details?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (details ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

const money = (value?: string) => (value === undefined || Number.isNaN(Number(value)) ? undefined : formatMoney(Number(value)));

/** Códigos cuja mensagem leva os valores do DETAIL (faltante, livre...). Sem o detalhe, usam o texto genérico. */
const DYNAMIC_RULES: Record<string, (info: Record<string, string>) => string> = {
  reserve_shortfall: (i) => {
    const gap = money(i.shortfall_cents);
    return gap
      ? `Esta operação usaria dinheiro que está reservado em cofrinhos: faltariam ${gap} de saldo na conta para cobrir a reserva. Retire ou use a reserva de um cofrinho dessa conta e tente de novo.`
      : "Esta operação usaria dinheiro que está reservado em cofrinhos. Retire ou use a reserva de um cofrinho dessa conta e tente de novo.";
  },
  insufficient_free: (i) => {
    const gap = money(i.shortfall_cents);
    const free = money(i.free_cents);
    const asked = i.shortfall_cents !== undefined && i.free_cents !== undefined ? money(String(Number(i.shortfall_cents) + Number(i.free_cents))) : undefined;
    return gap && free && asked
      ? `Saldo livre insuficiente na conta: você pediu ${asked}, mas só há ${free} livres (faltam ${gap}).`
      : "Saldo livre insuficiente na conta para reservar esse valor.";
  },
  insufficient_pocket: (i) => {
    const gap = money(i.shortfall_cents);
    const balance = money(i.balance_cents);
    return gap && balance ? `O cofrinho tem só ${balance}: faltam ${gap}.` : "O cofrinho não tem esse valor reservado.";
  },
};

/** Erro de domínio/banco com a mensagem pronta para o usuário + o código estável e os valores (para a interface). */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly info: Record<string, string> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

/** Código de domínio contido no erro (por palavra inteira), se houver. */
export function ruleCodeOf(error: DbErrorLike): string | undefined {
  const text = `${error.message} ${error.details ?? ""}`;
  return [...Object.keys(DYNAMIC_RULES), ...Object.keys(RULE_CODES)].find((code) => hasWord(text, code));
}

/** Erro de regra levantado pelo motor LOCAL: mesma mensagem e mesmo código que o banco devolveria. */
export function appError(code: string, info: Record<string, string | number> = {}): AppError {
  const details = Object.entries(info)
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
  return new AppError(friendlyDbMessage({ message: code, details }), code, parseDetails(details));
}

export function friendlyDbMessage(error: DbErrorLike): string {
  const text = `${error.message} ${error.details ?? ""}`;

  // Por palavra inteira: "use_pay_invoice" não pode casar com "use_pay_invoice_flow".
  const rule = ruleCodeOf(error);
  if (rule) return rule in DYNAMIC_RULES ? DYNAMIC_RULES[rule](parseDetails(error.details)) : RULE_CODES[rule];

  switch (error.code) {
    case "23505": {
      const constraint = Object.keys(UNIQUE_BY_CONSTRAINT).find((name) => text.includes(name));
      return constraint ? UNIQUE_BY_CONSTRAINT[constraint] : "Já existe um registro com esses dados.";
    }
    case "23503":
      return /update or delete on table/i.test(error.message)
        ? "Este registro está em uso por outros dados e não pode ser excluído. Desative-o em vez de excluir."
        : "Referência inválida: o item relacionado não existe neste espaço.";
    case "23514": {
      const constraint = Object.keys(CHECK_BY_CONSTRAINT).find((name) => text.includes(name));
      return constraint ? CHECK_BY_CONSTRAINT[constraint] : "Algum valor está fora do permitido. Confira os campos e tente novamente.";
    }
    case "22001":
      return "Algum valor está fora do permitido. Confira os campos e tente novamente.";
    case "22P02":
    case "22007":
    case "22008":
      return "Algum valor está em formato inválido. Confira os campos e tente novamente.";
    case "42501":
      return "Você não tem permissão para esta ação.";
    case "PGRST116":
      return "Registro não encontrado (pode ter sido removido ou não pertencer ao seu espaço).";
    case "28000":
      return "Sua sessão expirou. Entre novamente.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    return "Sem conexão com o servidor. Verifique sua internet e tente novamente.";
  }
  return "Não foi possível concluir a operação. Tente novamente.";
}

export function toFriendlyError(error: DbErrorLike): AppError {
  if (process.env.NODE_ENV !== "production") {
    // Detalhe técnico só para desenvolvimento (a UI mostra apenas a mensagem amigável).
    console.warn("[finora:db]", error.code ?? "-", error.message, error.details ?? "");
  }
  // Violação de CHECK conhecida: o código estável é o nome da restrição (o motor local usa o mesmo código).
  const check = error.code === "23514" ? Object.keys(CHECK_BY_CONSTRAINT).find((name) => `${error.message} ${error.details ?? ""}`.includes(name)) : undefined;
  return new AppError(friendlyDbMessage(error), ruleCodeOf(error) ?? check, parseDetails(error.details), { cause: error });
}

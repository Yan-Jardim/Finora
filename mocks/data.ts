import type {
  Account,
  Category,
  CreditCard,
  Debt,
  FinancialProfile,
  Goal,
  InstallmentPurchase,
  ISODate,
  Pocket,
  PocketMovement,
  RecurringTransaction,
  Transaction,
} from "@/domain/types";

/**
 * Dados fictícios para validar UI/arquitetura sem backend.
 * Serão substituídos por repositórios Supabase em services/ — a UI não muda.
 */

export const MOCK_CURRENT_USER = { name: "Yan", profileId: "p-yan" };

const brl = (value: number) => Math.round(value * 100);

export const profiles: FinancialProfile[] = [
  { id: "p-yan", name: "Yan", color: "#4f46e5", kind: "individual", active: true },
  { id: "p-camila", name: "Camila", color: "#db2777", kind: "individual", active: true },
  { id: "p-casal", name: "Casal", color: "#0d9488", kind: "shared", active: true },
];

export const accounts: Account[] = [
  { id: "a-nubank", name: "Nubank", institution: "Nubank", ownerProfileId: "p-yan", type: "digital", initialBalanceCents: brl(3000 + 4 * 792.31), color: "#8a05be", icon: "smartphone", includeInNetWorth: true, active: true },
  { id: "a-mp", name: "Mercado Pago", institution: "Mercado Pago", ownerProfileId: "p-yan", type: "digital", initialBalanceCents: brl(800), color: "#0ea5e9", icon: "smartphone", includeInNetWorth: true, active: true },
  { id: "a-santander", name: "Santander", institution: "Santander", ownerProfileId: "p-camila", type: "checking", initialBalanceCents: brl(2500), color: "#dc2626", icon: "landmark", includeInNetWorth: true, active: true },
  { id: "a-conjunta", name: "Conta conjunta", institution: "Itaú", ownerProfileId: "p-casal", type: "checking", initialBalanceCents: brl(6000), color: "#f59e0b", icon: "landmark", includeInNetWorth: true, active: true },
  { id: "a-cofre", name: "Dinheiro guardado em casa", ownerProfileId: "p-casal", type: "cash", initialBalanceCents: brl(1200), color: "#16a34a", icon: "banknote", includeInNetWorth: true, active: true },
  { id: "a-invest", name: "Carteira de investimentos", institution: "Corretora", ownerProfileId: "p-yan", type: "investment", initialBalanceCents: brl(15000), color: "#0f766e", icon: "trending-up", includeInNetWorth: true, active: true },
];

export const creditCards: CreditCard[] = [
  { id: "c-nubank", name: "Nubank Ultravioleta", accountId: "a-nubank", ownerProfileId: "p-yan", brand: "mastercard", limitCents: brl(8000), closingDay: 3, dueDay: 10, color: "#8a05be", last4: "4821", active: true },
  { id: "c-santander", name: "Santander Free", accountId: "a-santander", ownerProfileId: "p-camila", brand: "visa", limitCents: brl(5000), closingDay: 20, dueDay: 27, color: "#dc2626", last4: "9034", active: true },
];

const category = (id: string, name: string, icon: string, color: string, kind: Category["kind"], parentId?: string): Category => ({
  id, name, icon, color, kind, parentId, active: true,
});

export const categories: Category[] = [
  category("moradia", "Moradia", "home", "#6366f1", "expense"),
  category("moradia-aluguel", "Aluguel", "home", "#6366f1", "expense", "moradia"),
  category("moradia-energia", "Energia", "home", "#6366f1", "expense", "moradia"),
  category("moradia-agua", "Água", "home", "#6366f1", "expense", "moradia"),
  category("moradia-internet", "Internet", "home", "#6366f1", "expense", "moradia"),
  category("alimentacao", "Alimentação", "utensils", "#f97316", "expense"),
  category("alimentacao-restaurante", "Restaurante", "utensils", "#f97316", "expense", "alimentacao"),
  category("alimentacao-delivery", "Delivery", "utensils", "#f97316", "expense", "alimentacao"),
  category("mercado", "Mercado", "shopping-cart", "#16a34a", "expense"),
  category("transporte", "Transporte", "car", "#0ea5e9", "expense"),
  category("saude", "Saúde", "heart-pulse", "#dc2626", "expense"),
  category("educacao", "Educação", "graduation-cap", "#8a05be", "expense"),
  category("lazer", "Lazer", "gamepad", "#db2777", "expense"),
  category("viagem", "Viagem", "plane", "#0d9488", "expense"),
  category("assinaturas", "Assinaturas", "repeat", "#8a05be", "expense"),
  category("dividas", "Dívidas", "landmark", "#64748b", "expense"),
  category("presentes", "Presentes", "gift", "#db2777", "expense"),
  category("roupas", "Roupas", "shirt", "#8a05be", "expense"),
  category("familia", "Família", "users", "#f59e0b", "expense"),
  category("outros", "Outros", "more", "#64748b", "both"),
  category("salario", "Salário", "briefcase", "#16a34a", "income"),
  category("freelance", "Freelance", "briefcase", "#0d9488", "income"),
  category("rendimentos", "Rendimentos", "trending-up", "#0d9488", "income"),
];

/**
 * Cofrinhos de demonstração: só cadastro; o saldo é derivado dos movimentos abaixo. As reservas CABEM no saldo da conta
 * (regra de lastro: reservado > 0 ⇒ saldo ≥ reservado), senão a demonstração já nasceria violando a regra.
 */
export const pockets: Pocket[] = [
  { id: "k-emergencia", name: "Emergência", icon: "piggy-bank", color: "#0d9488", profileId: "p-casal", accountId: "a-conjunta", status: "active", createdAt: "2026-01-01T12:00:00.000Z" },
  { id: "k-viagem", name: "Viagem", icon: "plane", color: "#4f46e5", profileId: "p-casal", accountId: "a-conjunta", status: "active", createdAt: "2026-01-01T12:00:01.000Z" },
];

export const pocketMovements: PocketMovement[] = [
  { id: "km-emergencia-1", pocketId: "k-emergencia", kind: "reserve", amountCents: brl(1200), date: "2026-01-02", note: "Saldo inicial", createdAt: "2026-01-02T12:00:00.000Z" },
  { id: "km-viagem-1", pocketId: "k-viagem", kind: "reserve", amountCents: brl(500), date: "2026-01-02", note: "Saldo inicial", createdAt: "2026-01-02T12:00:01.000Z" },
];

/** Objetivos de demonstração: um ligado a cofrinho (progresso real) e um manual (progresso informado). */
export const goals: Goal[] = [
  { id: "g-viagem", name: "Viagem para a Inglaterra", kind: "travel", targetCents: brl(15000), profileId: "p-casal", icon: "plane", color: "#4f46e5", status: "active", pocketId: "k-viagem", manualAmountCents: 0 },
  { id: "g-carro", name: "Troca de carro", kind: "vehicle", targetCents: brl(40000), profileId: "p-yan", icon: "car", color: "#be123c", status: "active", manualAmountCents: brl(5000) },
];

type TxInput = Omit<Transaction, "tags" | "amountCents"> & { amount: number; tags?: string[] };
const tx = ({ amount, tags = [], ...rest }: TxInput): Transaction => ({
  ...rest,
  amountCents: brl(amount),
  tags,
});

const addMonths = (date: ISODate, months: number): ISODate => {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * Compra parcelada: a compra original NÃO é uma Transaction.
 * Apenas as parcelas são — assim a despesa nunca é contada duas vezes.
 */
const notebookInstallments: Transaction[] = Array.from({ length: 10 }, (_, i) =>
  tx({
    id: `t-notebook-${i + 1}`,
    kind: "credit_card_purchase",
    description: "Notebook",
    amount: 300,
    date: addMonths("2026-09-15", i),
    status: i === 0 ? "pending" : "planned",
    categoryId: "outros",
    cardId: "c-nubank",
    profileId: "p-yan",
    tags: ["Trabalho"],
    installment: { purchaseId: "ip-notebook", number: i + 1, total: 10, purchaseDate: "2026-09-15" },
  }),
);

export const installmentPurchases: InstallmentPurchase[] = [
  {
    id: "ip-notebook",
    description: "Notebook",
    totalCents: brl(3000),
    installments: 10,
    firstDate: "2026-09-15",
    cardId: "c-nubank",
    profileId: "p-yan",
    categoryId: "outros",
    tags: ["Trabalho"],
  },
];

export const transactions: Transaction[] = [
  // Receitas
  tx({ id: "t-1", kind: "income", description: "Salário", amount: 9500, date: "2026-10-05", paidAt: "2026-10-05", status: "paid", categoryId: "salario", accountId: "a-nubank", profileId: "p-yan" }),
  tx({ id: "t-2", kind: "income", description: "Salário", amount: 6200, date: "2026-10-05", paidAt: "2026-10-05", status: "paid", categoryId: "salario", accountId: "a-santander", profileId: "p-camila" }),
  tx({ id: "t-3", kind: "income", description: "Freelance — site", amount: 1800, date: "2026-10-15", dueDate: "2026-10-15", status: "pending", categoryId: "freelance", accountId: "a-nubank", profileId: "p-yan" }),
  tx({ id: "t-4", kind: "income", description: "Rendimentos", amount: 142.37, date: "2026-10-01", paidAt: "2026-10-01", status: "paid", categoryId: "rendimentos", accountId: "a-invest", profileId: "p-yan" }),

  // Despesas em conta
  tx({ id: "t-5", kind: "expense", description: "Aluguel", amount: 3200, date: "2026-10-05", paidAt: "2026-10-05", status: "paid", categoryId: "moradia-aluguel", accountId: "a-conjunta", profileId: "p-casal", tags: ["Casal"] }),
  tx({ id: "t-6", kind: "expense", description: "Mercado", amount: 487.9, date: "2026-10-02", paidAt: "2026-10-02", status: "paid", categoryId: "mercado", accountId: "a-conjunta", profileId: "p-casal", tags: ["Casal"] }),
  tx({ id: "t-7", kind: "expense", description: "Internet", amount: 119.9, date: "2026-10-10", dueDate: "2026-10-10", status: "pending", categoryId: "moradia-internet", accountId: "a-conjunta", profileId: "p-casal", tags: ["Casal"] }),
  tx({ id: "t-8", kind: "expense", description: "Energia", amount: 214.6, date: "2026-10-25", dueDate: "2026-10-25", status: "pending", categoryId: "moradia-energia", accountId: "a-conjunta", profileId: "p-casal", tags: ["Casal"] }),
  tx({ id: "t-9", kind: "expense", description: "Plano de saúde", amount: 640, date: "2026-10-15", dueDate: "2026-10-15", status: "pending", categoryId: "saude", accountId: "a-santander", profileId: "p-camila" }),
  tx({ id: "t-10", kind: "expense", description: "Academia", amount: 129.9, date: "2026-10-08", dueDate: "2026-10-08", status: "pending", categoryId: "saude", accountId: "a-nubank", profileId: "p-yan" }),
  tx({ id: "t-11", kind: "expense", description: "Uber", amount: 38.4, date: "2026-10-04", paidAt: "2026-10-04", status: "paid", categoryId: "transporte", accountId: "a-nubank", profileId: "p-yan" }),

  // Dívida: 4 parcelas já pagas (jun–set). As demais são DERIVADAS do contrato (a parcela 5 vence em 12/10); só os
  // pagamentos são transações, e o saldo inicial do Nubank já compensa o que saiu.
  ...["2026-06-12", "2026-07-12", "2026-08-12", "2026-09-12"].map((date, i) =>
    tx({ id: `t-12-${i + 1}`, kind: "debt_payment", description: "Pagamento — Empréstimo Banco X", amount: 792.31, date, paidAt: date, status: "paid", categoryId: "dividas", accountId: "a-nubank", profileId: "p-yan", debtId: "d-banco-x" }),
  ),

  // Compras no cartão (consomem limite; não mexem no saldo da conta)
  tx({ id: "t-13", kind: "credit_card_purchase", description: "Restaurante Outback", amount: 214, date: "2026-10-03", status: "pending", categoryId: "alimentacao-restaurante", cardId: "c-nubank", profileId: "p-casal", tags: ["Casal"] }),
  tx({ id: "t-14", kind: "credit_card_purchase", description: "Netflix", amount: 55.9, date: "2026-10-05", status: "pending", categoryId: "assinaturas", cardId: "c-nubank", profileId: "p-casal" }),
  tx({ id: "t-15", kind: "credit_card_purchase", description: "Spotify", amount: 21.9, date: "2026-09-28", status: "pending", categoryId: "assinaturas", cardId: "c-nubank", profileId: "p-yan" }),
  tx({ id: "t-16", kind: "credit_card_purchase", description: "Mercado Extra", amount: 312.45, date: "2026-09-30", status: "pending", categoryId: "mercado", cardId: "c-nubank", profileId: "p-casal" }),
  tx({ id: "t-17", kind: "credit_card_purchase", description: "Farmácia", amount: 87.2, date: "2026-10-04", status: "pending", categoryId: "saude", cardId: "c-santander", profileId: "p-camila" }),
  tx({ id: "t-18", kind: "credit_card_purchase", description: "Roupas — Zara", amount: 389, date: "2026-10-02", status: "pending", categoryId: "roupas", cardId: "c-santander", profileId: "p-camila" }),
  ...notebookInstallments,

  // Gastos futuros
  tx({ id: "t-20", kind: "expense", description: "Passagem para Londres", amount: 4500, date: "2026-12-10", status: "planned", categoryId: "viagem", accountId: "a-conjunta", profileId: "p-casal", tags: ["Londres", "Dezembro2026", "Casal"] }),
  tx({ id: "t-21", kind: "expense", description: "IPVA", amount: 2000, date: "2027-01-15", status: "planned", categoryId: "transporte", accountId: "a-nubank", profileId: "p-yan" }),

  // Movimentos que NÃO são gasto: o dinheiro só muda de lugar
  tx({ id: "t-22", kind: "transfer", description: "Nubank → Mercado Pago", amount: 1000, date: "2026-10-03", paidAt: "2026-10-03", status: "paid", accountId: "a-nubank", toAccountId: "a-mp", profileId: "p-yan" }),
  tx({ id: "t-23", kind: "investment", description: "Aporte — renda fixa", amount: 1500, date: "2026-10-04", paidAt: "2026-10-04", status: "paid", accountId: "a-nubank", toAccountId: "a-invest", profileId: "p-yan" }),
];

/** Dados iniciais entregues aos repositórios (mesmos tipos dos cadastros do usuário). */
/** Empréstimo de exemplo: recebeu R$ 8.000, paga R$ 10.300 em 13x (parcela 5 vence em 12/10/2026). */
export const debts: Debt[] = [
  { id: "d-banco-x", name: "Empréstimo Banco X", creditor: "Banco X", kind: "loan", profileId: "p-yan", principalCents: brl(8000), totalCents: brl(10300), installments: 13, firstDueDate: "2026-06-12", paymentAccountId: "a-nubank", categoryId: "dividas", status: "active" },
];

/** Sem recorrências de exemplo: gerariam ocorrências e alterariam os números da demonstração. */
export const recurringTransactions: RecurringTransaction[] = [];

export const seeds = { profiles, categories, accounts, creditCards, transactions, installmentPurchases, recurringTransactions, debts, pockets, pocketMovements, goals };

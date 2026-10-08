import { z } from "zod";
import { isValidISODate } from "@/domain/dates";
import type { InstallmentPurchaseInput } from "@/domain/installments";
import type { Category, ISODate, Transaction } from "@/domain/types";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { normalizeTags } from "@/lib/tags";
import { moneyField, optionalText, requiredText } from "./shared";

/** Tipos que o usuário cria pelo formulário (pagamento de fatura tem fluxo próprio). */
export const formKinds = ["income", "expense", "transfer", "credit_card_purchase"] as const;
export type FormKind = (typeof formKinds)[number];

export const MAX_INSTALLMENTS = 48;

const optionalDate = z.string().refine((v) => v === "" || isValidISODate(v), "Informe uma data válida.");

export const transactionSchema = z
  .object({
    kind: z.enum(formKinds),
    description: requiredText("a descrição", 80),
    amount: moneyField({ positive: true }),
    date: z.string().refine(isValidISODate, "Informe uma data válida."),
    /** Vencimento (despesa) ou data prevista (receita). */
    dueDate: optionalDate,
    status: z.enum(["planned", "pending", "paid"]),
    /** Receita: conta de destino. Despesa: conta. Transferência: conta de origem. */
    accountId: z.string(),
    toAccountId: z.string(),
    cardId: z.string(),
    profileId: z.string().min(1, "Escolha o perfil financeiro."),
    categoryId: z.string(),
    subcategoryId: z.string(),
    tags: z.array(z.string()),
    notes: optionalText(300),
    installmentsEnabled: z.boolean(),
    installments: z.string(),
  })
  .superRefine((v, ctx) => {
    const fail = (path: keyof typeof v, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (v.kind === "income" && !v.accountId) fail("accountId", "Escolha a conta de destino.");
    if (v.kind === "expense" && !v.accountId) fail("accountId", "Escolha a conta.");
    if (v.kind === "transfer") {
      if (!v.accountId) fail("accountId", "Escolha a conta de origem.");
      if (!v.toAccountId) fail("toAccountId", "Escolha a conta de destino.");
      else if (v.accountId && v.accountId === v.toAccountId) fail("toAccountId", "A conta de destino deve ser diferente da origem.");
    }
    if (v.kind === "credit_card_purchase") {
      if (!v.cardId) fail("cardId", "Escolha o cartão.");
      if (v.installmentsEnabled) {
        const n = Number(v.installments);
        if (!Number.isInteger(n) || n < 2) fail("installments", "Informe 2 ou mais parcelas.");
        else if (n > MAX_INSTALLMENTS) fail("installments", `Máximo de ${MAX_INSTALLMENTS} parcelas.`);
      }
    }
    // Categoria é obrigatória onde há classificação (tudo, exceto transferência).
    if (v.kind !== "transfer" && !v.categoryId) fail("categoryId", "Escolha a categoria.");
  });

export type TransactionFormValues = z.infer<typeof transactionSchema>;

export function transactionDefaults(kind: FormKind, today: ISODate, profileId = ""): TransactionFormValues {
  return {
    kind,
    description: "",
    amount: "",
    date: today,
    dueDate: "",
    status: kind === "credit_card_purchase" ? "pending" : "paid",
    accountId: "",
    toAccountId: "",
    cardId: "",
    profileId,
    categoryId: "",
    subcategoryId: "",
    tags: [],
    notes: "",
    installmentsEnabled: false,
    installments: "2",
  };
}

export function transactionToForm(tx: Transaction, categories: Category[]): TransactionFormValues {
  const category = categories.find((c) => c.id === tx.categoryId);
  return {
    kind: tx.kind as FormKind,
    description: tx.description,
    amount: centsToInput(tx.amountCents),
    date: tx.date,
    dueDate: tx.dueDate ?? "",
    status: tx.status === "canceled" || tx.status === "overdue" ? "pending" : tx.status,
    accountId: tx.accountId ?? "",
    toAccountId: tx.toAccountId ?? "",
    cardId: tx.cardId ?? "",
    profileId: tx.profileId,
    categoryId: category?.parentId ?? category?.id ?? "",
    subcategoryId: category?.parentId ? category.id : "",
    tags: tx.tags,
    notes: tx.notes ?? "",
    installmentsEnabled: false,
    installments: "2",
  };
}

/** Campos comuns -> movimentação (sem id). Cuida de status/paidAt conforme o tipo. */
export function transactionFromForm(v: TransactionFormValues, today: ISODate): Omit<Transaction, "id"> {
  const amountCents = parseMoneyToCents(v.amount) ?? 0;
  const base = {
    kind: v.kind,
    description: v.description.trim(),
    amountCents,
    date: v.date,
    tags: normalizeTags(v.tags),
    profileId: v.profileId,
    notes: v.notes.trim() || undefined,
  };

  if (v.kind === "transfer") {
    return {
      ...base,
      status: v.status,
      paidAt: v.status === "paid" ? v.date : undefined,
      accountId: v.accountId,
      toAccountId: v.toAccountId,
    };
  }

  const categoryId = v.subcategoryId || v.categoryId || undefined;

  if (v.kind === "credit_card_purchase") {
    // Status da compra no cartão é derivado da data: no futuro = prevista; senão, está na fatura.
    return { ...base, categoryId, cardId: v.cardId, status: v.date <= today ? "pending" : "planned" };
  }

  return {
    ...base,
    categoryId,
    accountId: v.accountId,
    dueDate: v.dueDate || undefined,
    status: v.status,
    paidAt: v.status === "paid" ? v.date : undefined,
  };
}

/** Compra parcelada: dados para gerar o agrupador + parcelas. */
export function installmentInputFromForm(v: TransactionFormValues): InstallmentPurchaseInput {
  return {
    description: v.description.trim(),
    totalCents: parseMoneyToCents(v.amount) ?? 0,
    installments: Number(v.installments),
    date: v.date,
    cardId: v.cardId,
    profileId: v.profileId,
    categoryId: v.subcategoryId || v.categoryId || undefined,
    tags: normalizeTags(v.tags),
    notes: v.notes.trim() || undefined,
  };
}

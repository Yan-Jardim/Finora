import { z } from "zod";
import { isValidISODate } from "@/domain/dates";
import type { Category, Debt, DebtKind, ISODate } from "@/domain/types";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import type { DebtInput, DebtPatch } from "@/services/debt-commands";
import { moneyField, optionalText, requiredText } from "./shared";

export const debtKinds = ["loan", "financing", "personal", "external_installment", "other"] as const;
export const MAX_DEBT_INSTALLMENTS = 120;

export const debtKindLabel: Record<DebtKind, string> = {
  loan: "Empréstimo",
  financing: "Financiamento",
  personal: "Dívida pessoal",
  external_installment: "Parcelamento externo",
  other: "Outro",
};

export const debtSchema = z
  .object({
    name: requiredText("o nome da dívida", 80),
    creditor: optionalText(80),
    kind: z.enum(debtKinds),
    profileId: z.string().min(1, "Escolha o responsável."),
    notes: optionalText(300),
    /** "Quanto recebeu/deve". */
    principal: moneyField({ positive: true }),
    /** "Quanto vai pagar no total". */
    total: moneyField({ positive: true }),
    hasInstallments: z.boolean(),
    installments: z.string(),
    firstDueDate: z.string(),
    paymentAccountId: z.string(),
    categoryId: z.string(),
  })
  .superRefine((v, ctx) => {
    const fail = (path: keyof typeof v, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const principal = parseMoneyToCents(v.principal);
    const total = parseMoneyToCents(v.total);
    if (principal !== null && total !== null && total < principal) {
      fail("total", "O total a pagar não pode ser menor que o valor original.");
    }
    if (v.hasInstallments) {
      const n = Number(v.installments);
      if (!Number.isInteger(n) || n < 1 || n > MAX_DEBT_INSTALLMENTS) {
        fail("installments", `Informe de 1 a ${MAX_DEBT_INSTALLMENTS} parcelas.`);
      }
      if (!isValidISODate(v.firstDueDate)) fail("firstDueDate", "Informe o primeiro vencimento.");
    }
  });

export type DebtFormValues = z.infer<typeof debtSchema>;

export function debtDefaults(today: ISODate, profileId = "", categoryId = ""): DebtFormValues {
  return {
    name: "",
    creditor: "",
    kind: "loan",
    profileId,
    notes: "",
    principal: "",
    total: "",
    hasInstallments: true,
    installments: "12",
    firstDueDate: today,
    paymentAccountId: "",
    categoryId,
  };
}

export function debtToForm(debt: Debt, categories: Category[]): DebtFormValues {
  const category = categories.find((c) => c.id === debt.categoryId);
  return {
    name: debt.name,
    creditor: debt.creditor ?? "",
    kind: debt.kind,
    profileId: debt.profileId,
    notes: debt.notes ?? "",
    principal: centsToInput(debt.principalCents),
    total: centsToInput(debt.totalCents),
    hasInstallments: !!debt.installments,
    installments: String(debt.installments ?? 12),
    firstDueDate: debt.firstDueDate ?? "",
    paymentAccountId: debt.paymentAccountId ?? "",
    categoryId: category?.id ?? "",
  };
}

export function debtFromForm(v: DebtFormValues): DebtInput {
  return {
    name: v.name.trim(),
    creditor: v.creditor.trim() || undefined,
    kind: v.kind,
    profileId: v.profileId,
    notes: v.notes.trim() || undefined,
    principalCents: parseMoneyToCents(v.principal) ?? 0,
    totalCents: parseMoneyToCents(v.total) ?? 0,
    installments: v.hasInstallments ? Number(v.installments) : undefined,
    firstDueDate: v.hasInstallments ? v.firstDueDate : undefined,
    paymentAccountId: v.paymentAccountId || undefined,
    categoryId: v.categoryId || undefined,
  };
}

/** Só o que MUDOU (vazio = nada a salvar). */
export function debtPatch(debt: Debt, next: DebtInput): DebtPatch {
  const patch: Record<string, unknown> = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const keys = ["name", "creditor", "kind", "profileId", "notes", "principalCents", "totalCents", "installments", "firstDueDate", "paymentAccountId", "categoryId"] as const;
  for (const key of keys) if (!same(debt[key], next[key])) patch[key] = next[key];
  return patch as DebtPatch;
}

/** Pagamento de dívida: valor + conta + data (o limite é o saldo devido, validado pelo banco). */
export const debtPaymentSchema = z.object({
  accountId: z.string().min(1, "Escolha a conta."),
  amount: z.string(),
  date: z.string().refine(isValidISODate, "Informe uma data válida."),
});
export type DebtPaymentFormValues = z.infer<typeof debtPaymentSchema>;

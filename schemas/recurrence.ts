import { z } from "zod";
import { MAX_RECURRENCE_INTERVAL } from "@/domain/recurrence";
import { isValidISODate } from "@/domain/dates";
import type { Category, ISODate, RecurringTransaction } from "@/domain/types";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { normalizeTags } from "@/lib/tags";
import type { RecurrenceInput, RecurrencePatch } from "@/services/recurrence-commands";
import { moneyField, optionalText, requiredText } from "./shared";

/** Tipos que podem recorrer nesta fase. Parcelamento é outra coisa (compra única dividida), não recorrência. */
export const recurringKinds = ["income", "expense", "credit_card_purchase"] as const;
export const recurrenceFrequencies = ["weekly", "monthly", "yearly"] as const;

const optionalDate = z.string().refine((v) => v === "" || isValidISODate(v), "Informe uma data válida.");

export const recurrenceSchema = z
  .object({
    kind: z.enum(recurringKinds),
    description: requiredText("a descrição", 80),
    amount: moneyField({ positive: true }),
    profileId: z.string().min(1, "Escolha o perfil financeiro."),
    accountId: z.string(),
    cardId: z.string(),
    categoryId: z.string(),
    subcategoryId: z.string(),
    tags: z.array(z.string()),
    notes: optionalText(300),
    frequency: z.enum(recurrenceFrequencies),
    interval: z.string(),
    startDate: z.string().refine(isValidISODate, "Informe uma data válida."),
    endDate: optionalDate,
    /** Só na edição: aplicar os novos valores às ocorrências futuras ainda não pagas. */
    applyToFuture: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const fail = (path: keyof typeof v, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.kind === "credit_card_purchase") {
      if (!v.cardId) fail("cardId", "Escolha o cartão.");
    } else if (!v.accountId) {
      fail("accountId", v.kind === "income" ? "Escolha a conta de destino." : "Escolha a conta.");
    }
    if (!v.categoryId) fail("categoryId", "Escolha a categoria.");
    const n = Number(v.interval);
    if (!Number.isInteger(n) || n < 1 || n > MAX_RECURRENCE_INTERVAL) {
      fail("interval", `Informe um número entre 1 e ${MAX_RECURRENCE_INTERVAL}.`);
    }
    if (v.endDate && isValidISODate(v.startDate) && v.endDate < v.startDate) {
      fail("endDate", "A data final não pode ser anterior à primeira ocorrência.");
    }
  });

export type RecurrenceFormValues = z.infer<typeof recurrenceSchema>;

export function recurrenceDefaults(kind: RecurringTransaction["kind"], today: ISODate, profileId = ""): RecurrenceFormValues {
  return {
    kind,
    description: "",
    amount: "",
    profileId,
    accountId: "",
    cardId: "",
    categoryId: "",
    subcategoryId: "",
    tags: [],
    notes: "",
    frequency: "monthly",
    interval: "1",
    startDate: today,
    endDate: "",
    applyToFuture: true,
  };
}

export function recurrenceToForm(rule: RecurringTransaction, categories: Category[]): RecurrenceFormValues {
  const category = categories.find((c) => c.id === rule.categoryId);
  return {
    kind: rule.kind,
    description: rule.description,
    amount: centsToInput(rule.amountCents),
    profileId: rule.profileId,
    accountId: rule.accountId ?? "",
    cardId: rule.cardId ?? "",
    categoryId: category?.parentId ?? category?.id ?? "",
    subcategoryId: category?.parentId ? category.id : "",
    tags: rule.tags,
    notes: rule.notes ?? "",
    frequency: rule.frequency,
    interval: String(rule.interval),
    startDate: rule.startDate,
    endDate: rule.endDate ?? "",
    applyToFuture: true,
  };
}

export function recurrenceFromForm(v: RecurrenceFormValues): RecurrenceInput {
  return {
    kind: v.kind,
    description: v.description.trim(),
    amountCents: parseMoneyToCents(v.amount) ?? 0,
    profileId: v.profileId,
    accountId: v.kind === "credit_card_purchase" ? undefined : v.accountId || undefined,
    cardId: v.kind === "credit_card_purchase" ? v.cardId || undefined : undefined,
    categoryId: v.subcategoryId || v.categoryId,
    tags: normalizeTags(v.tags),
    notes: v.notes.trim() || undefined,
    frequency: v.frequency,
    interval: Number(v.interval),
    startDate: v.startDate,
    endDate: v.endDate || undefined,
  };
}

/** Só o que MUDOU (evita reiniciar a agenda sem necessidade). Vazio = nada a salvar. */
export function recurrencePatch(rule: RecurringTransaction, next: RecurrenceInput): RecurrencePatch {
  const patch: RecurrencePatch = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const keys: (keyof RecurrencePatch)[] = [
    "description", "amountCents", "profileId", "accountId", "cardId", "categoryId", "tags", "notes",
    "frequency", "interval", "startDate", "endDate",
  ];
  for (const key of keys) {
    if (!same(rule[key as keyof RecurringTransaction], next[key])) (patch as Record<string, unknown>)[key] = next[key];
  }
  return patch;
}

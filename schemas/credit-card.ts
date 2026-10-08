import { z } from "zod";
import type { CreditCard } from "@/domain/types";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { DEFAULT_COLOR } from "@/lib/palette";
import { colorField, dayField, moneyField, requiredText } from "./shared";

export const cardBrands = ["visa", "mastercard", "elo", "amex", "hipercard", "other"] as const;

export const creditCardSchema = z.object({
  name: requiredText("o nome do cartão"),
  ownerProfileId: z.string().min(1, "Escolha o proprietário."),
  /** Conta padrão para pagar a fatura. "" = nenhuma (opcional). */
  accountId: z.string(),
  /** "" = não informada. */
  brand: z.union([z.enum(cardBrands), z.literal("")]),
  limit: moneyField({ positive: true }),
  closingDay: dayField,
  dueDay: dayField,
  /** Apenas os 4 últimos dígitos. Nunca pedimos o número completo nem o CVV. */
  last4: z.string().regex(/^(\d{4})?$/, "Informe exatamente 4 dígitos."),
  color: colorField,
});

export type CreditCardFormValues = z.infer<typeof creditCardSchema>;

export const creditCardDefaults: CreditCardFormValues = {
  name: "",
  ownerProfileId: "",
  accountId: "",
  brand: "",
  limit: "",
  closingDay: "",
  dueDay: "",
  last4: "",
  color: DEFAULT_COLOR,
};

export const cardToForm = (c: CreditCard): CreditCardFormValues => ({
  name: c.name,
  ownerProfileId: c.ownerProfileId,
  accountId: c.accountId ?? "",
  brand: c.brand ?? "",
  limit: centsToInput(c.limitCents),
  closingDay: String(c.closingDay),
  dueDay: String(c.dueDay),
  last4: c.last4 ?? "",
  color: c.color,
});

export const cardFromForm = (v: CreditCardFormValues) => ({
  name: v.name.trim(),
  ownerProfileId: v.ownerProfileId,
  accountId: v.accountId || undefined,
  brand: v.brand || undefined,
  limitCents: parseMoneyToCents(v.limit) ?? 0,
  closingDay: Number(v.closingDay),
  dueDay: Number(v.dueDay),
  last4: v.last4 || undefined,
  color: v.color,
});

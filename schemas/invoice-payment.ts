import { z } from "zod";
import { isValidISODate } from "@/domain/dates";
import { moneyField } from "./shared";

export const invoicePaymentSchema = z.object({
  /** "YYYY-MM" do vencimento da fatura. */
  invoiceMonth: z.string().min(1, "Escolha a fatura."),
  accountId: z.string().min(1, "Escolha a conta de pagamento."),
  amount: moneyField({ positive: true }),
  date: z.string().refine(isValidISODate, "Informe uma data válida."),
});

export type InvoicePaymentFormValues = z.infer<typeof invoicePaymentSchema>;

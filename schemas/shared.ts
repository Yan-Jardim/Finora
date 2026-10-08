import { z } from "zod";
import { parseMoneyToCents } from "@/lib/money";

export const requiredText = (label: string, max = 60) =>
  z.string().trim().min(1, `Informe ${label}.`).max(max, `Máximo de ${max} caracteres.`);

export const optionalText = (max = 60) => z.string().trim().max(max, `Máximo de ${max} caracteres.`);

export const colorField = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Escolha uma cor.");

/** Dinheiro como texto no formulário ("1.250,00"); convertido para centavos ao salvar. */
export const moneyField = (opts: { allowNegative?: boolean; positive?: boolean } = {}) =>
  z.string().superRefine((value, ctx) => {
    const cents = parseMoneyToCents(value);
    if (cents === null) return ctx.addIssue({ code: "custom", message: "Informe um valor válido. Ex.: 1.250,00" });
    if (!opts.allowNegative && cents < 0) ctx.addIssue({ code: "custom", message: "O valor não pode ser negativo." });
    if (opts.positive && cents <= 0) ctx.addIssue({ code: "custom", message: "Informe um valor maior que zero." });
  });

export const dayField = z.string().refine((v) => /^\d{1,2}$/.test(v) && +v >= 1 && +v <= 31, "Informe um dia entre 1 e 31.");

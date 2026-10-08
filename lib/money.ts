import type { Cents } from "@/domain/types";

/**
 * Converte o texto digitado em centavos. Aceita "1.234,56", "1234,56", "1234.56", "-50".
 * Retorna null se não for um número válido.
 */
export function parseMoneyToCents(input: string): Cents | null {
  const text = input.replace(/[R$\s]/g, "");
  if (!text) return null;
  const hasComma = text.includes(",");
  // Com vírgula: pontos são milhar. Sem vírgula: ponto é decimal.
  const normalized = hasComma ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** 125000 -> "1250,00" (para preencher inputs). */
export function centsToInput(cents: Cents): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

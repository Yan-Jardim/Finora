/**
 * CSV para Excel/Planilhas em pt-BR: separador ";", decimal com vírgula, quebra de linha CRLF e BOM UTF-8 (acentos).
 * Texto que começaria com = + - @ (ou tab/CR) recebe um apóstrofo na frente: evita que a planilha o execute como FÓRMULA
 * (CSV injection) com descrições digitadas pelo usuário.
 */
export interface RawCell {
  raw: string;
}
export type Cell = string | number | boolean | null | undefined | RawCell;

const isRaw = (c: Cell): c is RawCell => typeof c === "object" && c !== null && "raw" in c;

/** Valor monetário em reais com vírgula (ex.: 123456 -> "1234,56"; −5 -> "-0,05"). Nunca recebe o apóstrofo de proteção. */
export const money = (cents: number): RawCell => {
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100);
  return { raw: `${cents < 0 ? "-" : ""}${reais},${String(abs % 100).padStart(2, "0")}` };
};

export const percent = (value: number | null): RawCell => ({ raw: value === null ? "" : String(value).replace(".", ",") });

const FORMULA_START = /^[=+\-@\t\r]/;

function escape(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  let text: string;
  if (isRaw(cell)) text = cell.raw;
  else if (typeof cell === "number") text = String(cell).replace(".", ",");
  else if (typeof cell === "boolean") text = cell ? "sim" : "não";
  else text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escape).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Baixa o CSV no navegador (só no cliente). */
export function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

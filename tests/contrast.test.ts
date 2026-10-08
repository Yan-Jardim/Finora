/**
 * CONTRASTE (WCAG 2.1 AA, texto normal ≥ 4.5:1) dos tokens de cor, nos temas claro e escuro, lidos de app/globals.css.
 * Também confere que o gráfico usa os mesmos tokens (nenhuma cor fixa fora do tema).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "..", "app", "globals.css"), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const light = tokens(css.slice(css.indexOf(":root"), css.indexOf("@media")));
const dark = tokens(css.slice(css.indexOf("@media (prefers-color-scheme: dark)")));

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** [texto, fundo]: combinações que o app realmente usa. */
const PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["foreground", "muted"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ["primary", "primary-soft"],
  ["primary", "card"],
  ["success", "success-soft"],
  ["success", "card"],
  ["warning", "warning-soft"],
  ["warning", "card"],
  ["danger", "danger-soft"],
  ["danger", "card"],
];

describe("contraste dos tokens (AA, texto ≥ 4.5:1)", () => {
  for (const [name, theme] of [["claro", light], ["escuro", dark]] as const) {
    it(`tema ${name}: tem todos os tokens`, () => {
      for (const [a, b] of PAIRS) expect(theme[a] && theme[b], `${a}/${b}`).toBeTruthy();
    });
    it.each(PAIRS)(`tema ${name}: %s sobre %s`, (a, b) => {
      expect(ratio(theme[a], theme[b]), `${a} (${theme[a]}) sobre ${b} (${theme[b]})`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("bordas e barras de progresso (elementos gráficos ≥ 3:1) distinguíveis do fundo do cartão — barras sempre acompanhadas de % em texto", () => {
    for (const theme of [light, dark]) {
      expect(ratio(theme.primary, theme.card)).toBeGreaterThanOrEqual(3);
      expect(ratio(theme.success, theme.card)).toBeGreaterThanOrEqual(3);
      expect(ratio(theme.danger, theme.card)).toBeGreaterThanOrEqual(3);
    }
  });

  it("os gráficos usam só tokens do tema (var(--...)), sem cores fixas", () => {
    const charts = fs.readFileSync(path.resolve(import.meta.dirname, "..", "components", "reports", "charts.tsx"), "utf8");
    const sections = fs.readFileSync(path.resolve(import.meta.dirname, "..", "components", "reports", "report-sections.tsx"), "utf8");
    expect(charts).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(sections).not.toMatch(/"#[0-9a-fA-F]{3,6}"/);
  });
});

"use client";

import { useCallback, useId, useState } from "react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Gráficos SVG sem biblioteca (o projeto já desenha o gráfico do planejamento à mão). Pensados para acessibilidade:
 *  - não dependem só de cor: cada série tem PADRÃO (sólido/listrado/pontilhado) ou traço e marcador próprios;
 *  - legenda visível, valores no tooltip (mouse, toque e TECLADO) e uma tabela de dados equivalente;
 *  - role="img" com resumo textual.
 */

export interface Series {
  name: string;
  /** Cor CSS (token do tema). */
  color: string;
  kind: "bar" | "line";
  /** Barras: padrão de preenchimento. Linhas: tracejado. */
  style?: "solid" | "stripe" | "dots" | "dashed";
  values: number[];
}

export const compactMoney = (cents: number) => {
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(".", ",")} mil`;
  return `${sign}R$ ${Math.round(abs)}`;
};

const MARKERS = ["circle", "square", "diamond"] as const;

function Marker({ x, y, shape, color }: { x: number; y: number; shape: (typeof MARKERS)[number]; color: string }) {
  const s = 4.5;
  if (shape === "square") return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} fill={color} stroke="var(--card)" strokeWidth="1.5" />;
  if (shape === "diamond") return <polygon points={`${x},${y - s - 1} ${x + s + 1},${y} ${x},${y + s + 1} ${x - s - 1},${y}`} fill={color} stroke="var(--card)" strokeWidth="1.5" />;
  return <circle cx={x} cy={y} r={s} fill={color} stroke="var(--card)" strokeWidth="1.5" />;
}

export function Legend({ series }: { series: Pick<Series, "name" | "color" | "kind" | "style">[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda do gráfico">
      {series.map((s, i) => (
        <li key={s.name} className="inline-flex items-center gap-1.5">
          <svg width="18" height="12" aria-hidden>
            {s.kind === "bar" ? (
              <>
                <rect width="18" height="12" rx="2" fill={s.color} opacity={s.style === "solid" || !s.style ? 1 : 0.35} />
                {s.style === "stripe" && <path d="M0 12 L12 0 M6 12 L18 0 M-6 12 L6 0 M12 12 L24 0" stroke={s.color} strokeWidth="2.5" />}
                {s.style === "dots" && [4, 9, 14].flatMap((x) => [3, 9].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill={s.color} />))}
              </>
            ) : (
              <>
                <line x1="0" y1="6" x2="18" y2="6" stroke={s.color} strokeWidth="2" strokeDasharray={s.style === "dashed" ? "4 3" : undefined} />
                <Marker x={9} y={6} shape={MARKERS[i % MARKERS.length]} color={s.color} />
              </>
            )}
          </svg>
          {s.name}
        </li>
      ))}
    </ul>
  );
}

export interface ComboChartProps {
  labels: string[];
  series: Series[];
  /** Resumo para leitores de tela. */
  summary: string;
  /** Formata o rótulo do eixo X para o tooltip (padrão: o próprio rótulo). */
  height?: number;
  testId?: string;
}

/** Largura real do contêiner: o gráfico é desenhado nela (fontes sempre em tamanho legível, também no celular). */
export function useWidth(initial = 640) {
  const [width, setWidth] = useState(initial);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const update = () => setWidth(Math.max(280, Math.round(node.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [width, ref] as const;
}

/** Barras agrupadas (valores ≥ 0) + linhas (qualquer sinal) sobre o mesmo eixo. */
export function ComboChart({ labels, series, summary, height = 240, testId }: ComboChartProps) {
  const uid = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const [W, widthRef] = useWidth();
  const H = height;
  const pad = { l: W < 420 ? 52 : 58, r: 12, t: 12, b: 28 };
  const bars = series.filter((s) => s.kind === "bar");
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const y = (v: number) => pad.t + plotH - ((v - min) / span) * plotH;
  const groupW = plotW / Math.max(1, labels.length);
  const barW = Math.min(36, (groupW * 0.72) / Math.max(1, bars.length));
  const xCenter = (i: number) => pad.l + groupW * i + groupW / 2;
  const ticks = [0, 1, 2, 3, 4].map((i) => min + (span * i) / 4);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plotW / 54))));

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <Legend series={series} />
      <div className="relative" ref={widthRef}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="block max-w-full overflow-visible">
          <defs>
            {series.map((s, i) =>
              s.kind === "bar" && s.style === "stripe" ? (
                <pattern key={i} id={`${uid}-p${i}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="7" height="7" fill={s.color} opacity="0.3" />
                  <rect width="3.5" height="7" fill={s.color} />
                </pattern>
              ) : s.kind === "bar" && s.style === "dots" ? (
                <pattern key={i} id={`${uid}-p${i}`} width="7" height="7" patternUnits="userSpaceOnUse">
                  <rect width="7" height="7" fill={s.color} opacity="0.3" />
                  <circle cx="3.5" cy="3.5" r="1.8" fill={s.color} />
                </pattern>
              ) : null,
            )}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={Math.abs(t) < 1 ? undefined : "3 4"} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">
                {compactMoney(Math.round(t))}
              </text>
            </g>
          ))}
          {min < 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--foreground)" strokeOpacity="0.5" />}
          {labels.map((label, i) => (
            <g key={label}>
              {active === i && <rect x={pad.l + groupW * i} y={pad.t} width={groupW} height={plotH} fill="var(--muted)" opacity="0.6" />}
              {bars.map((s, bi) => {
                const v = s.values[i] ?? 0;
                const x = xCenter(i) - (bars.length * barW) / 2 + bi * barW;
                const si = series.indexOf(s);
                const fill = s.style === "stripe" || s.style === "dots" ? `url(#${uid}-p${si})` : s.color;
                return <rect key={s.name} x={x + 1} y={y(Math.max(v, 0))} width={Math.max(2, barW - 2)} height={Math.max(0, Math.abs(y(v) - y(0)))} rx="2" fill={fill} stroke={s.color} strokeWidth="1" />;
              })}
              {i % every === 0 && (
                <text x={xCenter(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
                  {label}
                </text>
              )}
              {/* alvo de interação (mouse, toque, teclado) */}
              <rect
                x={pad.l + groupW * i}
                y={pad.t}
                width={groupW}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${label}: ${series.map((s) => `${s.name} ${formatMoney(s.values[i] ?? 0)}`).join("; ")}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
              />
            </g>
          ))}
          {series
            .filter((s) => s.kind === "line")
            .map((s, li) => (
              <g key={s.name}>
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.25"
                  strokeDasharray={s.style === "dashed" ? "6 4" : undefined}
                  points={s.values.map((v, i) => `${xCenter(i)},${y(v)}`).join(" ")}
                />
                {s.values.map((v, i) => (
                  <Marker key={i} x={xCenter(i)} y={y(v)} shape={MARKERS[li % MARKERS.length]} color={s.color} />
                ))}
              </g>
            ))}
        </svg>
        {active !== null && (
          <div role="status" className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
            <p className="mb-1 font-semibold">{labels[active]}</p>
            {series.map((s) => (
              <p key={s.name} className="flex justify-between gap-4 tabular-nums">
                <span className="text-muted-foreground">{s.name}</span>
                <span>{formatMoney(s.values[active] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <DataTable labels={labels} series={series} />
    </div>
  );
}

/** Os mesmos números do gráfico em tabela (leitores de tela, impressão e conferência). */
export function DataTable({ labels, series, caption = "Dados do gráfico" }: { labels: string[]; series: Pick<Series, "name" | "values">[]; caption?: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Ver dados em tabela</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[320px] text-left tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">
                Período
              </th>
              {series.map((s) => (
                <th key={s.name} scope="col" className="py-1 pr-3 text-right font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label} className="border-t border-border">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {label}
                </th>
                {series.map((s) => (
                  <td key={s.name} className="py-1 pr-3 text-right">
                    {formatMoney(s.values[i] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Barra horizontal simples (categorias): o valor e o % ficam em TEXTO ao lado. */
export function MeterBar({ percent, color, className }: { percent: number; color: string; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, percent))}%`, backgroundColor: color }} />
    </div>
  );
}

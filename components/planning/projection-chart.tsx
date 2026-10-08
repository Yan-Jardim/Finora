"use client";

import { useWidth } from "@/components/reports/charts";
import { monthShort } from "@/lib/planning-messages";
import { formatMoney } from "@/lib/format";

interface Point {
  month: string;
  value: number;
}

/**
 * Evolução do saldo projetado (fim de cada mês). SVG simples, sem biblioteca: linha principal, linha de zero e, quando
 * há simulação, uma segunda linha tracejada. Valores negativos ficam abaixo da linha de zero.
 */
export function ProjectionChart({ points, compare, label }: { points: Point[]; compare?: Point[]; label: string }) {
  const [W, widthRef] = useWidth();
  if (points.length === 0) return null;
  const H = 200;
  const pad = { l: 24, r: 24, t: 16, b: 26 };
  const everyOther = W < 420 && points.length > 4 ? 3 : 2;
  const all = [...points, ...(compare ?? [])].map((p) => p.value);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // O zero só entra na escala quando o saldo chega perto dele ou abaixo; senão a linha ficaria achatada.
  const margin = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.2;
  const showsZero = lo < 0 || lo - margin <= 0;
  const min = showsZero ? Math.min(0, lo - margin) : lo - margin;
  const max = showsZero ? Math.max(0, hi + margin) : hi + margin;
  const span = max - min || 1;
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + ((max - v) * (H - pad.t - pad.b)) / span;
  const path = (list: Point[]) => list.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <figure className="w-full" ref={widthRef as never}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block max-w-full">
        <title>{label}</title>
        {showsZero && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="4 4" />}
        {compare && <path d={path(compare)} fill="none" stroke="var(--warning)" strokeWidth={2} strokeDasharray="6 4" />}
        <path d={path(points)} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.month} cx={x(i)} cy={y(p.value)} r={3.5} fill={p.value < 0 ? "var(--danger)" : "var(--primary)"}>
            <title>{`${monthShort(p.month)}: ${formatMoney(p.value)}`}</title>
          </circle>
        ))}
        {points.map((p, i) =>
          points.length <= 6 || i % everyOther === 0 || i === points.length - 1 ? (
            <text key={p.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
              {monthShort(p.month)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>Saldo no fim de cada mês</span>
        <span className={last.value < 0 ? "text-danger" : undefined}>
          {monthShort(last.month)}: <strong className="tabular-nums">{formatMoney(last.value)}</strong>
        </span>
      </figcaption>
    </figure>
  );
}

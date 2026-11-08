import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

import { formatINR, formatINRCompact } from "../../lib/money";

export type CashflowPoint = { label: string; inflow: number; outflow: number };

// Fixed series order and colours (validated for colour-blind separation on white).
const SERIES = [
  { key: "inflow", color: "var(--chart-1)" },
  { key: "outflow", color: "var(--chart-2)" },
] as const;

const tick = { fill: "var(--muted)", fontSize: 11 };

/** Inflow vs outflow per period, as grouped bars. Values are rupees (display only). */
export function CashflowBarChart({
  data,
  height = 260,
  names = ["Inflow", "Outflow"],
}: {
  data: CashflowPoint[];
  height?: number;
  /** Legend / tooltip names for the two series, in order. */
  names?: readonly [string, string];
}) {
  return (
    <div>
      <ul className="mb-3 flex gap-4 text-xs font-medium text-muted">
        {SERIES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            {names[i]}
          </li>
        ))}
      </ul>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="25%" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" minTickGap={10} />
            <YAxis width={52} tickLine={false} axisLine={false} tick={tick} tickFormatter={(v: number) => formatINRCompact(v)} />
            <Tooltip cursor={{ fill: "var(--surface-muted)" }} content={CashflowTooltip} offset={12} allowEscapeViewBox={{ x: false, y: true }} />
            {SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={names[i]} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Dark pill (as in the design reference) naming the month and both values — text in ink-on-dark, a dot carries the series colour. */
function CashflowTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-sidebar px-3.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg">
      <span className="font-semibold">{label}</span>
      {payload.map((p) => (
        <span key={String(p.dataKey)} className="flex items-center gap-1.5 text-white/80">
          <span className="size-2 rounded-full ring-1 ring-white/60" style={{ background: p.color }} aria-hidden />
          {p.name}
          <span className="font-semibold text-white tabular-nums">{formatINR(String(p.value ?? 0), { showDecimals: false })}</span>
        </span>
      ))}
    </div>
  );
}

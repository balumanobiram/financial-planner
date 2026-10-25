import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

import { formatINR, formatINRCompact } from "../../lib/money";

export type CashflowPoint = { label: string; inflow: number; outflow: number };

// Fixed series order and colours (validated for colour-blind separation on white).
const SERIES = [
  { key: "inflow", name: "Inflow", color: "var(--chart-1)" },
  { key: "outflow", name: "Outflow", color: "var(--chart-2)" },
] as const;

const tick = { fill: "var(--muted)", fontSize: 11 };

/** Inflow vs outflow per period, as grouped bars. Values are rupees (display only). */
export function CashflowBarChart({ data, height = 260 }: { data: CashflowPoint[]; height?: number }) {
  return (
    <div>
      <ul className="mb-3 flex gap-4 text-xs font-medium text-muted">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.name}
          </li>
        ))}
      </ul>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="25%" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" minTickGap={10} />
            <YAxis width={52} tickLine={false} axisLine={false} tick={tick} tickFormatter={(v: number) => formatINRCompact(v)} />
            <Tooltip cursor={{ fill: "var(--surface-muted)" }} content={CashflowTooltip} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CashflowTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-xl bg-surface px-3 py-2.5 text-xs shadow-card ring-1 ring-line">
      <p className="mb-1.5 font-semibold text-ink">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 py-0.5 text-muted">
          <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
          {p.name}
          <span className="ml-auto pl-4 font-semibold text-ink tabular-nums">
            {formatINR(String(p.value ?? 0), { showDecimals: false })}
          </span>
        </p>
      ))}
    </div>
  );
}

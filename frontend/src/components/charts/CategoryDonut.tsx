import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipContentProps } from "recharts";

import type { CategorySlice } from "../../api/dashboard";
import { formatINR, toPaise } from "../../lib/money";

/**
 * Spending by category. Each slice wears its category's own colour (colour follows the
 * entity, not its rank), slices are separated by a 2px surface gap, and the legend
 * always names every slice with its % — so identity never depends on colour alone.
 */
export function CategoryDonut({ slices, total }: { slices: CategorySlice[]; total: string }) {
  const data = slices.map((s) => ({ ...s, value: Number(toPaise(s.amount)) / 100 }));

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={0} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
              {data.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={DonutTooltip} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="text-[11px] text-muted">Spent</span>
          <span className="text-base font-bold tabular-nums">{formatINR(total, { showDecimals: false })}</span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-2.5 text-sm">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-muted tabular-nums">{formatINR(s.amount, { showDecimals: false })}</span>
            <span className="w-12 text-right font-semibold tabular-nums">{s.percent.replace(/\.0$/, "")}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DonutTooltip({ active, payload }: TooltipContentProps) {
  const s = payload?.[0]?.payload as CategorySlice | undefined;
  if (!active || !s) return null;
  return (
    <div className="rounded-full bg-sidebar px-3 py-1.5 text-xs whitespace-nowrap text-white shadow-lg">
      <span className="font-semibold">{s.name}</span> <span className="tabular-nums">{formatINR(s.amount, { showDecimals: false })} · {s.percent}%</span>
    </div>
  );
}

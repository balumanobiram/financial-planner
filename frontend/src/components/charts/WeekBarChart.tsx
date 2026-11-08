import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, type LabelProps, type TooltipContentProps } from "recharts";

import { formatINR, formatINRCompact } from "../../lib/money";

export type WeekBar = { label: string; day: string; amount: string; value: number; isToday: boolean; isFuture: boolean };

/**
 * Mon–Sun spending. One series, so no legend: today is the dark bar with its value
 * in a badge; past days are light; days still to come are a faint outline.
 */
export function WeekBarChart({ data, height = 200 }: { data: WeekBar[]; height?: number }) {
  // An all-zero week would draw nothing; a tiny floor keeps the day slots visible.
  const max = Math.max(...data.map((d) => d.value), 1);
  const shown = data.map((d) => ({ ...d, bar: d.isFuture ? max * 0.04 : Math.max(d.value, max * 0.04) }));

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={shown} margin={{ top: 34, right: 0, bottom: 0, left: 0 }} barCategoryGap="18%">
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
          <Tooltip cursor={false} content={WeekTooltip} />
          <Bar dataKey="bar" radius={[10, 10, 10, 10]} isAnimationActive={false}>
            {shown.map((d) => (
              <Cell
                key={d.day}
                fill={d.isToday ? "var(--primary)" : d.isFuture ? "transparent" : "var(--line)"}
                stroke={d.isFuture ? "var(--line)" : undefined}
                strokeDasharray={d.isFuture ? "4 3" : undefined}
              />
            ))}
            <LabelList dataKey="value" content={(props) => <TodayBadge {...props} bars={shown} />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TodayBadge({ x, y, width, index, bars }: LabelProps & { bars: WeekBar[] }) {
  const bar = index === undefined ? undefined : bars[index];
  if (!bar?.isToday) return null;
  const text = formatINRCompact(bar.value);
  const w = Math.max(44, text.length * 7 + 16);
  const cx = Number(x) + Number(width) / 2;
  const top = Number(y) - 30;
  return (
    <g aria-hidden>
      <rect x={cx - w / 2} y={top} width={w} height={22} rx={7} fill="var(--sidebar)" />
      <text x={cx} y={top + 15} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700}>
        {text}
      </text>
    </g>
  );
}

function WeekTooltip({ active, payload }: TooltipContentProps) {
  const bar = payload?.[0]?.payload as WeekBar | undefined;
  if (!active || !bar || bar.isFuture) return null;
  return (
    <div className="rounded-full bg-sidebar px-3 py-1.5 text-xs whitespace-nowrap text-white shadow-lg">
      <span className="font-semibold">{bar.label}</span> <span className="tabular-nums">{formatINR(bar.amount, { showDecimals: false })}</span>
    </div>
  );
}

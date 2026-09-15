import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthPoint } from "@/lib/analytics";

/**
 * Invoiced-vs-collected trend.
 *
 * Kept in its own module and loaded with `React.lazy` from the dashboard:
 * recharts is ~400kB and this is the only chart in the app, so bundling it into
 * the main entry doubled first-load size for a view most sessions scroll past.
 */
export default function RevenueTrendChart({
  data,
  formatValue,
}: {
  data: MonthPoint[];
  formatValue: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="invoicedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.28} />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgb(var(--divider))" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "rgb(var(--text-secondary))" }}
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tick={{ fontSize: 11, fill: "rgb(var(--text-secondary))" }}
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
        />
        <Tooltip
          cursor={{ stroke: "rgb(var(--divider))" }}
          contentStyle={{
            background: "rgb(var(--surface))",
            border: "1px solid rgb(var(--divider))",
            borderRadius: 12,
            fontSize: 12,
          }}
          formatter={(value: number, name: string) => [formatValue(value), name]}
        />
        <Area
          type="monotone"
          dataKey="invoiced"
          name="Invoiced"
          stroke="rgb(var(--accent))"
          strokeWidth={2}
          fill="url(#invoicedFill)"
        />
        <Line
          type="monotone"
          dataKey="collected"
          name="Collected"
          stroke="rgb(var(--text-secondary))"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

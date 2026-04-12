"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { incidentTrend } from "@/lib/mock-data";

const COLORS = {
  critical: "#cc2d1a",
  high: "#dd6020",
  moderate: "#e6a020",
  low: "#4ead7a",
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-sentinel-sidebar border border-sentinel-border rounded-md p-3 shadow-xl">
      <p className="text-xs font-semibold text-sentinel-text mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-xs text-sentinel-muted capitalize">{entry.name}:</span>
          <span className="text-xs font-mono font-medium text-sentinel-text">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend() {
  return (
    <div className="flex items-center justify-center gap-6 mt-2">
      {Object.entries(COLORS).reverse().map(([key, color]) => (
        <div key={key} className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs font-medium text-sentinel-muted capitalize">{key}</span>
        </div>
      ))}
    </div>
  );
}

export function IncidentTrend() {
  return (
    <div className="bg-sentinel-card border border-sentinel-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sentinel-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-sentinel-text">Incident Trend — 7 Days</h2>
        </div>
        <span className="text-xs font-mono text-sentinel-subtle">Apr 6 – Apr 12, 2026</span>
      </div>

      {/* Chart */}
      <div className="px-4 pt-4 pb-2">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart
            data={incidentTrend}
            margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradCritical" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.critical} stopOpacity={0.25} />
                <stop offset="95%" stopColor={COLORS.critical} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradHigh" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.high} stopOpacity={0.2} />
                <stop offset="95%" stopColor={COLORS.high} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradModerate" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.moderate} stopOpacity={0.2} />
                <stop offset="95%" stopColor={COLORS.moderate} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradLow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.low} stopOpacity={0.2} />
                <stop offset="95%" stopColor={COLORS.low} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#252d3d"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "#6b7589", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "#252d3d" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#6b7589", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#252d3d", strokeWidth: 1 }} />

            <Area
              type="monotone"
              dataKey="low"
              stackId="1"
              stroke={COLORS.low}
              strokeWidth={1.5}
              fill="url(#gradLow)"
            />
            <Area
              type="monotone"
              dataKey="moderate"
              stackId="1"
              stroke={COLORS.moderate}
              strokeWidth={1.5}
              fill="url(#gradModerate)"
            />
            <Area
              type="monotone"
              dataKey="high"
              stackId="1"
              stroke={COLORS.high}
              strokeWidth={1.5}
              fill="url(#gradHigh)"
            />
            <Area
              type="monotone"
              dataKey="critical"
              stackId="1"
              stroke={COLORS.critical}
              strokeWidth={1.5}
              fill="url(#gradCritical)"
            />
          </AreaChart>
        </ResponsiveContainer>
        <CustomLegend />
      </div>
    </div>
  );
}

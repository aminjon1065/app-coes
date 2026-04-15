"use client";

import { format, parseISO } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { IncidentVolumePoint } from "@/lib/api/analytics-workspace";

type IncidentVolumeChartProps = {
  data: IncidentVolumePoint[];
  groupBy: "day" | "week" | "month";
};

function formatBucket(bucket: string, groupBy: "day" | "week" | "month") {
  const date = parseISO(bucket);

  if (groupBy === "month") {
    return format(date, "MMM yyyy");
  }

  return format(date, "dd MMM");
}

export function IncidentVolumeChart({
  data,
  groupBy,
}: IncidentVolumeChartProps) {
  const chartData = data.map((item) => ({
    ...item,
    label: formatBucket(item.bucket, groupBy),
  }));

  return (
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Incident volume
          </p>
          <h2 className="mt-2 text-xl font-medium text-white">
            Load trend across the selected window
          </h2>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {chartData.reduce((sum, item) => sum + item.count, 0)} incidents
        </div>
      </div>

      <div className="mt-5 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="incidentVolumeFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(10,16,28,0.96)",
              }}
              labelStyle={{ color: "#e2e8f0" }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#22d3ee"
              strokeWidth={2}
              fill="url(#incidentVolumeFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

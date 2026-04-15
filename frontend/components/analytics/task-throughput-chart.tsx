"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TaskThroughputPoint } from "@/lib/api/analytics-workspace";

type TaskThroughputChartProps = {
  data: TaskThroughputPoint[];
};

const STATUS_COLORS: Record<string, string> = {
  done: "#34d399",
  review: "#fbbf24",
  in_progress: "#38bdf8",
  blocked: "#fb7185",
  cancelled: "#94a3b8",
};

export function TaskThroughputChart({ data }: TaskThroughputChartProps) {
  return (
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Task throughput
          </p>
          <h2 className="mt-2 text-xl font-medium text-white">
            Final task distribution by status
          </h2>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {data.reduce((sum, item) => sum + item.count, 0)} tasks
        </div>
      </div>

      <div className="mt-5 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis
              dataKey="status"
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
            <Bar dataKey="count" name="Tasks" radius={[14, 14, 4, 4]}>
              {data.map((entry) => (
                <Cell
                  key={entry.status}
                  fill={STATUS_COLORS[entry.status] ?? "#22d3ee"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {data.map((item) => (
          <div
            key={item.status}
            className="rounded-[22px] border border-white/10 bg-black/15 p-4"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[item.status] ?? "#22d3ee" }}
              />
              <span className="text-sm font-medium capitalize text-white">
                {item.status.replaceAll("_", " ")}
              </span>
            </div>
            <div className="mt-3 text-sm text-slate-300">
              {item.count} tasks / start {item.avgTimeToStartMinutes} min / complete{" "}
              {item.avgTimeToCompleteMinutes} min
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

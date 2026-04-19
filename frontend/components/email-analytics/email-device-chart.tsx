"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const DATA = [
  { device: "Smartphone", opened: 52, clicks: 38 },
  { device: "Desktop/Laptop", opened: 84, clicks: 96 },
  { device: "Tablet", opened: 35, clicks: 22 },
  { device: "Smartwatch", opened: 62, clicks: 48 },
  { device: "Other", opened: 28, clicks: 42 },
];

export function EmailDeviceChart() {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.14)]">
      <h2 className="text-base font-semibold text-white">Performance By Device Type</h2>
      <div className="mt-2 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500" />
          Opened
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-300/50" />
          Clicks
        </span>
      </div>
      <div className="mt-4 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={DATA} barCategoryGap="30%" barGap={3}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="device"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              ticks={[0, 20, 40, 60, 80, 100]}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(10,16,28,0.96)",
                fontSize: 12,
              }}
              labelStyle={{ color: "#e2e8f0" }}
              formatter={(value: number, name: string) => [
                value,
                name === "opened" ? "Opened" : "Clicks",
              ]}
            />
            <Bar dataKey="opened" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            <Bar dataKey="clicks" fill="rgba(129,140,248,0.35)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

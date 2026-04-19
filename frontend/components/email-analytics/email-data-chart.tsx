"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const DATA = [
  { year: "2014", clickThrough: 8, openRate: 5 },
  { year: "2015", clickThrough: 18, openRate: 10 },
  { year: "2016", clickThrough: 38, openRate: 22 },
  { year: "2017", clickThrough: 63, openRate: 55 },
  { year: "2018", clickThrough: 52, openRate: 68 },
  { year: "2019", clickThrough: 42, openRate: 78 },
  { year: "2020", clickThrough: 35, openRate: 62 },
  { year: "2021", clickThrough: 28, openRate: 45 },
  { year: "2022", clickThrough: 20, openRate: 30 },
];

export function EmailDataChart() {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.14)]">
      <h2 className="text-base font-semibold text-white">Email Data Chart</h2>
      <div className="mt-2 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500" />
          Click through rate
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-400" />
          Open rate
        </span>
      </div>
      <div className="mt-4 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={DATA}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              ticks={[0, 20, 40, 60, 80, 100]}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                `${value}%`,
                name === "clickThrough" ? "Click through rate" : "Open rate",
              ]}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(10,16,28,0.96)",
                fontSize: 12,
              }}
              labelStyle={{ color: "#e2e8f0" }}
            />
            <ReferenceLine
              x="2017"
              stroke="rgba(255,255,255,0.15)"
              label={{
                value: "63%",
                position: "top",
                fill: "#fff",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
            <Line
              type="monotone"
              dataKey="clickThrough"
              stroke="#7c3aed"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: "#7c3aed" }}
            />
            <Line
              type="monotone"
              dataKey="openRate"
              stroke="#818cf8"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: "#818cf8" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

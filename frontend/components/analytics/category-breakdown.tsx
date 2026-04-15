"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CategoryBreakdownPoint } from "@/lib/api/analytics-workspace";
import { formatMinutes } from "@/lib/api/analytics-workspace";

type CategoryBreakdownProps = {
  data: CategoryBreakdownPoint[];
};

const COLORS = ["#22d3ee", "#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc"];

function clickedCategory(entry: unknown) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const value = (entry as { category?: unknown }).category;
  return typeof value === "string" ? value : null;
}

export function CategoryBreakdown({ data }: CategoryBreakdownProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(
    data[0]?.category ?? null,
  );

  const selected =
    data.find((item) => item.category === activeCategory) ?? data[0] ?? null;

  return (
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Category breakdown
          </p>
          <h2 className="mt-2 text-xl font-medium text-white">
            Incident mix across response types
          </h2>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          Click a slice to inspect
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="category"
                innerRadius={54}
                outerRadius={92}
                paddingAngle={4}
                onClick={(entry) => {
                  const category = clickedCategory(entry);
                  if (category) {
                    setActiveCategory(category);
                  }
                }}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={entry.category}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(10,16,28,0.96)",
                }}
                labelStyle={{ color: "#e2e8f0" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-3">
          {data.map((item, index) => {
            const active = item.category === selected?.category;

            return (
              <button
                key={item.category}
                type="button"
                onClick={() => setActiveCategory(item.category)}
                className={`w-full rounded-[22px] border p-4 text-left transition ${
                  active
                    ? "border-cyan-300/30 bg-cyan-300/10"
                    : "border-white/10 bg-black/15 hover:bg-white/10"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="text-sm font-medium capitalize text-white">
                        {item.category}
                      </span>
                    </div>
                    <div className="mt-3 text-sm text-slate-300">
                      Peak severity {item.severityPeak} / avg resolution{" "}
                      {formatMinutes(item.avgResolutionMinutes)}
                    </div>
                  </div>
                  <div className="text-2xl font-medium text-white">{item.count}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

"use client";

import { RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import type { SlaComplianceDto } from "@/lib/api/analytics-workspace";

type SlaComplianceGaugeProps = {
  data: SlaComplianceDto;
};

export function SlaComplianceGauge({ data }: SlaComplianceGaugeProps) {
  const chartData = [
    {
      name: "Compliance",
      value: data.compliancePct,
      fill: data.compliancePct >= 90 ? "#34d399" : data.compliancePct >= 75 ? "#fbbf24" : "#fb7185",
    },
  ];

  return (
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            SLA compliance
          </p>
          <h2 className="mt-2 text-xl font-medium text-white">
            Completion discipline in the selected window
          </h2>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {data.total} tracked tasks
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="72%"
              outerRadius="100%"
              barSize={18}
              data={chartData}
              startAngle={210}
              endAngle={-30}
            >
              <RadialBar background dataKey="value" cornerRadius={18} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-col justify-center">
          <div className="text-5xl font-medium text-white">
            {data.compliancePct.toFixed(1)}%
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            {data.compliant} tasks landed inside SLA and {data.breached} slipped
            outside the expected response window.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-[22px] border border-emerald-400/20 bg-emerald-400/8 p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/70">
                Compliant
              </div>
              <div className="mt-2 text-2xl font-medium text-emerald-50">
                {data.compliant}
              </div>
            </div>
            <div className="rounded-[22px] border border-rose-400/20 bg-rose-400/8 p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-rose-100/70">
                Breached
              </div>
              <div className="mt-2 text-2xl font-medium text-rose-50">
                {data.breached}
              </div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/15 p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Total
              </div>
              <div className="mt-2 text-2xl font-medium text-white">{data.total}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

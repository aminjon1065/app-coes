"use client";

import { ArrowUpRight, ArrowDownRight, ExternalLink } from "lucide-react";

type KpiCard = {
  label: string;
  value: string;
  subLabel: string;
  subValue: string;
  trend: number;
  trendLabel: string;
};

const KPI_DATA: KpiCard[] = [
  {
    label: "Sent",
    value: "1,181",
    subLabel: "104 Emails",
    subValue: "",
    trend: 0.5,
    trendLabel: "0.5%",
  },
  {
    label: "Open Rate",
    value: "86.84%",
    subLabel: "33 Opened",
    subValue: "",
    trend: -1.7,
    trendLabel: "1.7%",
  },
  {
    label: "Click Rate",
    value: "2.63%",
    subLabel: "1 Clicked",
    subValue: "",
    trend: -2.3,
    trendLabel: "2.3%",
  },
  {
    label: "Click Through",
    value: "3.03%",
    subLabel: "15 Click Through",
    subValue: "",
    trend: 1.0,
    trendLabel: "1.0%",
  },
];

export function EmailKpiStrip() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {KPI_DATA.map((card) => {
        const positive = card.trend >= 0;
        return (
          <article
            key={card.label}
            className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-300">{card.label}</p>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-white">{card.value}</span>
              <span
                className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                  positive
                    ? "bg-emerald-400/15 text-emerald-300"
                    : "bg-rose-400/15 text-rose-300"
                }`}
              >
                {positive ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {card.trendLabel}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{card.subLabel}</p>
          </article>
        );
      })}
    </section>
  );
}

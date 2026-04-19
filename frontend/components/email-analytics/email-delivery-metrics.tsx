"use client";

import { Info } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer } from "recharts";

const MINI_BARS = [
  { v: 20 }, { v: 35 }, { v: 28 }, { v: 45 }, { v: 38 },
  { v: 55 }, { v: 48 }, { v: 62 }, { v: 58 }, { v: 72 },
];

const MINI_BARS_BOUNCE = [
  { v: 60 }, { v: 45 }, { v: 72 }, { v: 55 }, { v: 80 },
  { v: 65 }, { v: 88 }, { v: 75 }, { v: 90 }, { v: 85 },
];

const MINI_BARS_UNSUB = [
  { v: 15 }, { v: 22 }, { v: 18 }, { v: 30 }, { v: 25 },
  { v: 35 }, { v: 28 }, { v: 32 }, { v: 27 }, { v: 28 },
];

const MINI_BARS_SPAM = [
  { v: 5 }, { v: 8 }, { v: 6 }, { v: 4 }, { v: 7 },
  { v: 5 }, { v: 9 }, { v: 6 }, { v: 8 }, { v: 7 },
];

type DeliveryCard = {
  label: string;
  value: string;
  subLabel?: string;
  subColor?: string;
  hasInfo?: boolean;
  barData: { v: number }[];
  barColor: string;
};

const DELIVERY_CARDS: DeliveryCard[] = [
  {
    label: "Delivered Rate",
    value: "100%",
    subLabel: "38 Delivered",
    subColor: "text-amber-400",
    barData: MINI_BARS,
    barColor: "#a78bfa",
  },
  {
    label: "Hard Bounce Rate",
    value: "85%",
    hasInfo: true,
    barData: MINI_BARS_BOUNCE,
    barColor: "#818cf8",
  },
  {
    label: "Unsubscribed Rate",
    value: "28%",
    hasInfo: true,
    barData: MINI_BARS_UNSUB,
    barColor: "#94a3b8",
  },
  {
    label: "Spam Report Rate",
    value: "0.7%",
    hasInfo: true,
    barData: MINI_BARS_SPAM,
    barColor: "#94a3b8",
  },
];

export function EmailDeliveryMetrics() {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.14)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Delivery</h2>
        <button className="text-xs font-medium text-violet-400 hover:text-violet-300 transition">
          SAVE REPORT
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DELIVERY_CARDS.map((card) => (
          <div key={card.label} className="rounded-xl border border-white/8 bg-white/4 p-4">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-slate-400">{card.label}</p>
              {card.hasInfo && <Info className="h-3 w-3 text-slate-600" />}
            </div>
            <p className="mt-2 text-2xl font-semibold text-white">{card.value}</p>
            {card.subLabel && (
              <p className={`mt-0.5 text-xs font-medium ${card.subColor ?? "text-slate-400"}`}>
                {card.subLabel}
              </p>
            )}
            <div className="mt-3 h-12">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={card.barData} barCategoryGap={2}>
                  <Bar dataKey="v" fill={card.barColor} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

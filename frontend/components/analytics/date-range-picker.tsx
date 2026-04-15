"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { endOfDay, format, startOfDay, subDays } from "date-fns";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

type DateRangePickerProps = {
  from: string;
  to: string;
  groupBy: "day" | "week" | "month";
};

const PRESETS = [
  { label: "7d", days: 6 },
  { label: "30d", days: 29 },
  { label: "90d", days: 89 },
];

export function DateRangePicker({
  from,
  to,
  groupBy,
}: DateRangePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [fromValue, setFromValue] = useState(format(new Date(from), "yyyy-MM-dd"));
  const [toValue, setToValue] = useState(format(new Date(to), "yyyy-MM-dd"));

  const activeSpan = useMemo(() => {
    const start = new Date(from);
    const end = new Date(to);
    const diff = Math.round(
      (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
    );
    return diff + 1;
  }, [from, to]);

  function pushParams(next: { from?: string; to?: string; groupBy?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.from) {
      params.set("from", next.from);
    }
    if (next.to) {
      params.set("to", next.to);
    }
    if (next.groupBy) {
      params.set("groupBy", next.groupBy);
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  function applyPreset(days: number) {
    const end = endOfDay(new Date());
    const start = startOfDay(subDays(end, days));
    const nextFrom = format(start, "yyyy-MM-dd");
    const nextTo = format(end, "yyyy-MM-dd");

    setFromValue(nextFrom);
    setToValue(nextTo);

    pushParams({
      from: start.toISOString(),
      to: end.toISOString(),
    });
  }

  function applyCustomRange() {
    if (!fromValue || !toValue) {
      return;
    }

    pushParams({
      from: startOfDay(new Date(fromValue)).toISOString(),
      to: endOfDay(new Date(toValue)).toISOString(),
    });
  }

  return (
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-100">
            <CalendarRange className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
              Date window
            </p>
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Compare operational pressure across a selected reporting interval.
          </p>
        </div>

        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {activeSpan} day window / {groupBy} buckets
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset.days)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
              activeSpan === preset.days + 1
                ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                : "border-white/10 bg-black/10 text-slate-400 hover:bg-white/10 hover:text-white",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex min-w-[170px] flex-1 flex-col gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
          From
          <input
            type="date"
            value={fromValue}
            onChange={(event) => setFromValue(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-cyan-300/30"
          />
        </label>

        <label className="flex min-w-[170px] flex-1 flex-col gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
          To
          <input
            type="date"
            value={toValue}
            onChange={(event) => setToValue(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-cyan-300/30"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {(["day", "week", "month"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => pushParams({ groupBy: value })}
              className={cn(
                "rounded-full border px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] transition",
                groupBy === value
                  ? "border-amber-300/30 bg-amber-300/10 text-amber-50"
                  : "border-white/10 bg-black/10 text-slate-400 hover:bg-white/10 hover:text-white",
              )}
            >
              {value}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={applyCustomRange}
          className="inline-flex items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
        >
          Apply range
        </button>
      </div>
    </section>
  );
}

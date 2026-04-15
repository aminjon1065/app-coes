"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { endOfDay, format, startOfDay } from "date-fns";
import { Filter } from "lucide-react";

type AuditFiltersProps = {
  filters: {
    actorId?: string;
    eventType?: string;
    targetType?: string;
    targetId?: string;
    from: string;
    to: string;
  };
};

export function AuditFilters({ filters }: AuditFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [form, setForm] = useState({
    actorId: filters.actorId ?? "",
    eventType: filters.eventType ?? "",
    targetType: filters.targetType ?? "",
    targetId: filters.targetId ?? "",
    from: format(new Date(filters.from), "yyyy-MM-dd"),
    to: format(new Date(filters.to), "yyyy-MM-dd"),
  });

  function updateField<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(form)) {
      if (!value) {
        params.delete(key);
        continue;
      }

      if (key === "from") {
        params.set("from", startOfDay(new Date(value)).toISOString());
        continue;
      }

      if (key === "to") {
        params.set("to", endOfDay(new Date(value)).toISOString());
        continue;
      }

      params.set(key, value);
    }

    params.delete("cursor");
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilters() {
    router.push(pathname);
  }

  return (
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-100">
            <Filter className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
              Audit filters
            </p>
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Narrow the log by actor, event type, target, and time window.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <input
          value={form.eventType}
          onChange={(event) => updateField("eventType", event.target.value)}
          placeholder="Event type contains..."
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/30"
        />
        <input
          value={form.targetType}
          onChange={(event) => updateField("targetType", event.target.value)}
          placeholder="Target type"
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/30"
        />
        <input
          value={form.actorId}
          onChange={(event) => updateField("actorId", event.target.value)}
          placeholder="Actor UUID"
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/30"
        />
        <input
          value={form.targetId}
          onChange={(event) => updateField("targetId", event.target.value)}
          placeholder="Target UUID"
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/30"
        />
        <input
          type="date"
          value={form.from}
          onChange={(event) => updateField("from", event.target.value)}
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/30"
        />
        <input
          type="date"
          value={form.to}
          onChange={(event) => updateField("to", event.target.value)}
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/30"
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={applyFilters}
          className="inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={clearFilters}
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/10"
        >
          Clear
        </button>
      </div>
    </section>
  );
}

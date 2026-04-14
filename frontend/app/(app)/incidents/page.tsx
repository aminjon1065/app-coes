import Link from "next/link";
import { Flame } from "lucide-react";
import { IncidentDirectoryToolbar } from "@/components/incident/incident-directory-toolbar";
import { IncidentIndexCard } from "@/components/incident/incident-index-card";
import { IncidentIndexPanel } from "@/components/incident/incident-index-panel";
import {
  INCIDENT_CATEGORY_OPTIONS,
  INCIDENT_SORT_OPTIONS,
  INCIDENT_STATUS_OPTIONS,
  loadIncidentDirectory,
} from "@/lib/api/incident-workspace";

type IncidentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function IncidentsPage({
  searchParams,
}: IncidentsPageProps) {
  const resolvedSearchParams = await searchParams;
  const q = firstParam(resolvedSearchParams.q)?.trim() ?? "";
  const status = firstParam(resolvedSearchParams.status) ?? "";
  const category = firstParam(resolvedSearchParams.category) ?? "";
  const severityValue = firstParam(resolvedSearchParams.severity) ?? "";
  const requestedSort = firstParam(resolvedSearchParams.sort) ?? "newest";
  const sort =
    INCIDENT_SORT_OPTIONS.find((item) => item.value === requestedSort)?.value ??
    "newest";
  const severity =
    severityValue && !Number.isNaN(Number(severityValue))
      ? Number(severityValue)
      : undefined;
  const workspace = await loadIncidentDirectory({
    q: q || undefined,
    status: status || undefined,
    category: category || undefined,
    severity,
    sort: sort || undefined,
  });

  return (
    <main className="space-y-6 pb-8">
      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-4xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                Incident workspace
              </p>
              <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
                Incident intake, search, and hand-off into the command workspace.
              </h1>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Create a new incident, filter the visible incident set, or jump
                straight into incident detail and its embedded task console.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Source
              </div>
              <div className="mt-2 text-sm font-medium text-white">
                {workspace.source === "api" ? "Backend incidents" : "Mock fallback"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {workspace.incidents.length} matched incidents
              </div>
            </div>
          </div>

          <IncidentDirectoryToolbar
            currentFilters={{
              q: q || undefined,
              status: status || undefined,
              category: category || undefined,
              severity,
              sort: sort || undefined,
            }}
          />

          <form className="mt-8 space-y-4" action="/incidents" method="get">
            <div className="grid gap-4 xl:grid-cols-[1.4fr_0.7fr_0.7fr_0.7fr_0.8fr]">
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search code, title, or description"
                className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
              />

              <select
                name="status"
                defaultValue={status}
                className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
              >
                <option value="">All statuses</option>
                {INCIDENT_STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <select
                name="category"
                defaultValue={category}
                className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
              >
                <option value="">All categories</option>
                {INCIDENT_CATEGORY_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <select
                name="severity"
                defaultValue={severityValue}
                className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
              >
                <option value="">All severities</option>
                <option value="1">Severity 1</option>
                <option value="2">Severity 2</option>
                <option value="3">Severity 3</option>
                <option value="4">Severity 4</option>
              </select>

              <select
                name="sort"
                defaultValue={sort}
                className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
              >
                {INCIDENT_SORT_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
              >
                Apply filters
              </button>
              <Link
                href="/incidents"
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/10"
              >
                Reset
              </Link>
            </div>
          </form>
        </div>

        <IncidentIndexPanel
          source={workspace.source}
          availableUsers={workspace.availableUsers}
          incidents={workspace.incidents}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {workspace.incidents.length > 0 ? (
          workspace.incidents.map((incident) => (
            <IncidentIndexCard key={incident.id} incident={incident} />
          ))
        ) : (
          <div className="rounded-[30px] border border-dashed border-white/10 bg-black/10 px-6 py-16 text-center text-slate-500 xl:col-span-2 2xl:col-span-3">
            No incidents match the current filter set.
          </div>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[30px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            Why this matters
          </p>
          <h2 className="mt-3 text-2xl font-medium text-white">
            Incident detail is now the hand-off point into task operations.
          </h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            The next screen uses the incident ID to scope the task board,
            overdue queue, selected task detail, and write actions so command
            staff can stay inside the incident context.
          </p>
        </div>

        <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(58,24,13,0.78),rgba(33,14,14,0.7))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
          <div className="flex items-center gap-3 text-rose-100">
            <Flame className="h-5 w-5" />
            <span className="text-sm font-medium">
              Incident detail is now the next primary UI slice.
            </span>
          </div>
          <p className="mt-4 text-sm leading-7 text-rose-50/85">
            Open any incident card above to inspect the integrated board and
            keep all task activity bound to one operational context.
          </p>
        </div>
      </section>
    </main>
  );
}

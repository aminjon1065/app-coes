import { Activity, BarChart3, Download } from "lucide-react";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { CategoryBreakdown } from "@/components/analytics/category-breakdown";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { IncidentVolumeChart } from "@/components/analytics/incident-volume-chart";
import { KpiStrip } from "@/components/analytics/kpi-strip";
import { SlaComplianceGauge } from "@/components/analytics/sla-compliance-gauge";
import { TaskThroughputChart } from "@/components/analytics/task-throughput-chart";
import {
  formatAnalyticsRangeLabel,
  loadAnalyticsWorkspace,
} from "@/lib/api/analytics-workspace";

type AnalyticsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function resolveIsoRange(from?: string, to?: string) {
  const resolvedTo = to ? new Date(to) : new Date();
  const resolvedFrom = from ? new Date(from) : subDays(resolvedTo, 29);

  return {
    from: startOfDay(resolvedFrom).toISOString(),
    to: endOfDay(resolvedTo).toISOString(),
  };
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const resolvedSearchParams = await searchParams;
  const from = firstParam(resolvedSearchParams.from);
  const to = firstParam(resolvedSearchParams.to);
  const requestedGroupBy = firstParam(resolvedSearchParams.groupBy);
  const groupBy =
    requestedGroupBy === "week" || requestedGroupBy === "month"
      ? requestedGroupBy
      : "day";
  const range = resolveIsoRange(from, to);
  const workspace = await loadAnalyticsWorkspace({
    from: range.from,
    to: range.to,
    groupBy,
  });
  const exportBaseUrl =
    process.env.COESCD_API_BASE_URL ??
    process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
    "http://localhost:3001/api/v1";

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 text-cyan-100">
              <BarChart3 className="h-5 w-5" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                Operations analytics
              </p>
            </div>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              Incident load, task throughput, and SLA pressure in one surface.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              This dashboard composes the backend analytics slice and falls back to
              seeded operational data if the API is not reachable.
            </p>
          </div>

          <div className="grid gap-3 sm:min-w-[260px]">
            <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
              <div className="flex items-center justify-end gap-2 text-cyan-100">
                <Activity className="h-4 w-4" />
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Source
                </span>
              </div>
              <div className="mt-2 text-sm font-medium text-white">
                {workspace.source === "api" ? "Backend analytics API" : "Local mock analytics"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {formatAnalyticsRangeLabel(workspace.from, workspace.to)}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <a
                href="#analytics-grid"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/10"
              >
                Review charts
              </a>
              <a
                href={`${exportBaseUrl}/analytics/export?from=${encodeURIComponent(workspace.from)}&to=${encodeURIComponent(workspace.to)}&type=incidents`}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </a>
            </div>
          </div>
        </div>
      </section>

      <DateRangePicker from={workspace.from} to={workspace.to} groupBy={groupBy} />
      <KpiStrip data={workspace.summary} />

      <section id="analytics-grid" className="grid gap-6 xl:grid-cols-2">
        <IncidentVolumeChart data={workspace.volume} groupBy={groupBy} />
        <TaskThroughputChart data={workspace.throughput} />
        <SlaComplianceGauge data={workspace.sla} />
        <CategoryBreakdown data={workspace.categories} />
      </section>
    </main>
  );
}

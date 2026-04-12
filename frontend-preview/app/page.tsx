import { Shell } from "@/components/shell/shell";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { ActiveIncidents } from "@/components/dashboard/active-incidents";
import { MapPreview } from "@/components/dashboard/map-preview";
import { TasksToday } from "@/components/dashboard/tasks-today";
import { CommActivity } from "@/components/dashboard/comm-activity";
import { SlaWarnings } from "@/components/dashboard/sla-warnings";
import { IncidentTrend } from "@/components/dashboard/incident-trend";
import { SlidersHorizontal, RefreshCw } from "lucide-react";

export default function DashboardPage() {
  // Current time — hardcoded for the demo (operators' timezone)
  const now = "12:32 TJT · Sun 12 Apr 2026";

  return (
    <Shell>
      <main className="p-4 space-y-4 min-h-full">
        {/* Page header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-sentinel-text">
              Good morning, Rustam.{" "}
              <span className="text-severity-4 font-bold">3 incidents need your attention.</span>
            </h1>
            <p className="text-xs text-sentinel-muted mt-0.5 font-mono">{now}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-sentinel-border text-sentinel-muted hover:bg-sentinel-border hover:text-sentinel-text transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-sentinel-border text-sentinel-muted hover:bg-sentinel-border hover:text-sentinel-text transition-colors">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filter
            </button>
          </div>
        </header>

        {/* KPI row */}
        <section>
          <KpiCards />
        </section>

        {/* Incidents + Map */}
        <section className="grid grid-cols-[1fr_340px] gap-4">
          <ActiveIncidents />
          <MapPreview />
        </section>

        {/* Tasks + Comm + SLA */}
        <section className="grid grid-cols-3 gap-4">
          <TasksToday />
          <CommActivity />
          <SlaWarnings />
        </section>

        {/* Trend chart */}
        <section>
          <IncidentTrend />
        </section>
      </main>
    </Shell>
  );
}

import { AlertTriangle, ClipboardList, Clock3, ShieldAlert } from "lucide-react";
import type { AnalyticsSummaryDto } from "@/lib/api/analytics-workspace";
import { formatMinutes } from "@/lib/api/analytics-workspace";

type KpiStripProps = {
  data: AnalyticsSummaryDto;
};

const KPI_CARDS = [
  {
    key: "openIncidents",
    label: "Open incidents",
    helper: "Current unresolved operations",
    Icon: AlertTriangle,
    tone: "border-cyan-400/20 bg-cyan-400/8 text-cyan-50",
  },
  {
    key: "avgResolutionMinutes",
    label: "Avg resolution",
    helper: "Mean closure duration",
    Icon: Clock3,
    tone: "border-amber-300/20 bg-amber-300/8 text-amber-50",
  },
  {
    key: "tasksTotal",
    label: "Tasks tracked",
    helper: "Throughput across the window",
    Icon: ClipboardList,
    tone: "border-emerald-400/20 bg-emerald-400/8 text-emerald-50",
  },
  {
    key: "tasksBreachedSla",
    label: "SLA pressure",
    helper: "Tasks already beyond SLA",
    Icon: ShieldAlert,
    tone: "border-rose-400/20 bg-rose-400/8 text-rose-50",
  },
] as const;

export function KpiStrip({ data }: KpiStripProps) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {KPI_CARDS.map(({ key, label, helper, Icon, tone }) => {
        const rawValue = data[key];
        const value =
          key === "avgResolutionMinutes"
            ? formatMinutes(rawValue)
            : rawValue.toLocaleString();

        return (
          <article
            key={key}
            className={`rounded-[28px] border p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] ${tone}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">
                  {label}
                </p>
                <div className="mt-3 text-3xl font-medium">{value}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-300">{helper}</p>
          </article>
        );
      })}
    </section>
  );
}

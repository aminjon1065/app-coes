import { Mail } from "lucide-react";
import { EmailKpiStrip } from "@/components/email-analytics/email-kpi-strip";
import { EmailDeliveryMetrics } from "@/components/email-analytics/email-delivery-metrics";
import { EmailDataChart } from "@/components/email-analytics/email-data-chart";
import { EmailDeviceChart } from "@/components/email-analytics/email-device-chart";
import { EmailPerformanceTable } from "@/components/email-analytics/email-performance-table";

export default function EmailAnalyticsPage() {
  return (
    <main className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-400/12">
            <Mail className="h-4 w-4 text-violet-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Email Analytics</h1>
            <p className="text-xs text-slate-500">Track opens, clicks, and deliverability</p>
          </div>
        </div>
        <button className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10 transition">
          Last 30 Days
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <EmailKpiStrip />
      <EmailDeliveryMetrics />

      <div className="grid gap-6 xl:grid-cols-2">
        <EmailDataChart />
        <EmailDeviceChart />
      </div>

      <EmailPerformanceTable />
    </main>
  );
}

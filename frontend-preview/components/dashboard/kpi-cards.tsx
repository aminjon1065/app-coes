import { kpiStats, type KpiStat } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Users } from "lucide-react";

function KpiCard({ stat }: { stat: KpiStat }) {
  const isDanger = stat.variant === "danger";
  const isWarning = stat.variant === "warning";
  const isSuccess = stat.variant === "success";

  return (
    <div
      className={cn(
        "relative flex flex-col gap-1.5 p-4 rounded-md border",
        "bg-coescd-card border-coescd-border",
        isDanger && "border-severity-4/30 bg-severity-bg-4",
        isWarning && "border-severity-2/30 bg-severity-bg-2",
        isSuccess && "border-severity-1/20"
      )}
    >
      {/* Critical pulsing dot */}
      {isDanger && (
        <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-severity-4 opacity-60" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-severity-4" />
        </span>
      )}

      <p className="text-2xs font-semibold tracking-widest text-coescd-subtle uppercase">
        {stat.label}
      </p>

      <div className="flex items-end gap-2">
        <span
          className={cn(
            "text-3xl font-bold tabular-nums leading-none",
            isDanger && "text-severity-4",
            isWarning && "text-severity-2",
            isSuccess && "text-severity-1",
            !isDanger && !isWarning && !isSuccess && "text-coescd-text"
          )}
        >
          {stat.value}
        </span>
        {isSuccess && stat.subValue && (
          <span className="text-sm text-coescd-muted mb-0.5 font-mono">{stat.subValue}</span>
        )}
      </div>

      {/* Trend */}
      <div className="flex items-center gap-1 text-xs">
        {stat.trend === "up" && (
          <TrendingUp
            className={cn("w-3 h-3", isDanger ? "text-severity-4" : "text-coescd-muted")}
          />
        )}
        {stat.trend === "down" && (
          <TrendingDown className="w-3 h-3 text-severity-1" />
        )}
        {stat.trend === "neutral" && (
          <Minus className="w-3 h-3 text-coescd-subtle" />
        )}
        <span
          className={cn(
            "text-xs",
            isDanger && stat.trend === "up" && "text-severity-4",
            isWarning && "text-severity-2",
            stat.trend === "down" && "text-severity-1",
            stat.trend === "neutral" && "text-coescd-subtle"
          )}
        >
          {stat.trendLabel}
        </span>
      </div>

      {/* Progress bar for ON DUTY */}
      {isSuccess && (
        <div className="mt-1 h-1 rounded-sm bg-coescd-border overflow-hidden">
          <div
            className="h-full bg-severity-1 rounded-sm transition-all"
            style={{ width: "82%" }}
          />
        </div>
      )}
    </div>
  );
}

export function KpiCards() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {kpiStats.map((stat, i) => (
        <KpiCard key={i} stat={stat} />
      ))}
    </div>
  );
}

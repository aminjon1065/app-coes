import { slaWarnings } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertOctagon, Clock, ArrowRight } from "lucide-react";

const incidentColors: Record<string, string> = {
  "EQ-2026-04-1234": "text-severity-4",
  "FL-2026-04-0980": "text-severity-3",
  "FR-2026-04-0871": "text-severity-3",
  "IN-2026-04-0820": "text-severity-2",
};

export function SlaWarnings() {
  return (
    <div className="flex flex-col bg-sentinel-card border border-sentinel-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sentinel-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-sentinel-text">SLA Warnings</h2>
          <span className="text-2xs font-bold px-1.5 py-0.5 rounded-sm bg-severity-bg-2 border border-severity-2/30 text-severity-2">
            {slaWarnings.length}
          </span>
        </div>
        <a
          href="/tasks?filter=sla"
          className="flex items-center gap-1 text-xs text-sentinel-primary hover:text-sentinel-text transition-colors"
        >
          All SLA <ArrowRight className="w-3 h-3" />
        </a>
      </div>

      {/* Warnings list */}
      <div className="flex-1 divide-y divide-sentinel-border overflow-y-auto">
        {slaWarnings.map((warning) => (
          <div
            key={warning.id}
            className={cn(
              "flex flex-col gap-1 px-4 py-3 hover:bg-sentinel-border/30 transition-colors",
              warning.overdue && "bg-severity-bg-4"
            )}
          >
            {/* Top row */}
            <div className="flex items-center gap-2">
              {warning.overdue ? (
                <AlertOctagon className="w-3.5 h-3.5 text-severity-4 shrink-0" />
              ) : warning.critical ? (
                <AlertTriangle className="w-3.5 h-3.5 text-severity-4 shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-severity-2 shrink-0" />
              )}
              <span className="font-mono text-xs text-sentinel-primary">{warning.taskId}</span>
              <span
                className={cn(
                  "ml-auto font-mono text-xs font-semibold",
                  warning.overdue && "text-severity-4",
                  !warning.overdue && warning.critical && "text-severity-4",
                  !warning.overdue && !warning.critical && warning.warning && "text-severity-2",
                  !warning.overdue && !warning.critical && !warning.warning && "text-sentinel-muted"
                )}
              >
                {warning.timeRemaining}
              </span>
            </div>

            {/* Task name */}
            <p className="text-xs text-sentinel-text truncate leading-tight ml-[22px]">
              {warning.taskName}
            </p>

            {/* Incident code */}
            <div className="flex items-center gap-1 ml-[22px]">
              <span
                className={cn(
                  "font-mono text-2xs",
                  incidentColors[warning.incidentCode] || "text-sentinel-muted"
                )}
              >
                {warning.incidentCode}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { incidents, type Incident } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { ArrowRight, ExternalLink } from "lucide-react";

const severityColors: Record<number, string> = {
  1: "bg-severity-1",
  2: "bg-severity-2",
  3: "bg-severity-3",
  4: "bg-severity-4",
};

const statusStyles: Record<string, string> = {
  OPEN: "text-coescd-muted bg-coescd-border",
  ESCALATED: "text-severity-4 bg-severity-bg-4 border border-severity-4/30",
  CONTAINED: "text-severity-1 bg-severity-bg-1 border border-severity-1/30",
  CLOSED: "text-coescd-subtle bg-coescd-border",
};

export function ActiveIncidents() {
  return (
    <div className="flex flex-col bg-coescd-card border border-coescd-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-coescd-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-coescd-text">Active Incidents</h2>
          <span className="text-2xs font-bold px-1.5 py-0.5 rounded-sm bg-coescd-border text-coescd-muted">
            {incidents.length}
          </span>
        </div>
        <a
          href="/incidents"
          className="flex items-center gap-1 text-xs text-coescd-primary hover:text-coescd-text transition-colors"
        >
          View all <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[20px_130px_1fr_80px_90px_110px_60px] gap-2 px-4 py-2 border-b border-coescd-border">
        <div />
        <p className="text-2xs font-semibold tracking-widest text-coescd-subtle uppercase">Code</p>
        <p className="text-2xs font-semibold tracking-widest text-coescd-subtle uppercase">Title / Location</p>
        <p className="text-2xs font-semibold tracking-widest text-coescd-subtle uppercase">Elapsed</p>
        <p className="text-2xs font-semibold tracking-widest text-coescd-subtle uppercase">Status</p>
        <p className="text-2xs font-semibold tracking-widest text-coescd-subtle uppercase">Commander</p>
        <div />
      </div>

      {/* Rows */}
      <div className="divide-y divide-coescd-border">
        {incidents.map((incident) => (
          <IncidentRow key={incident.id} incident={incident} />
        ))}
      </div>
    </div>
  );
}

function IncidentRow({ incident }: { incident: Incident }) {
  const isCritical = incident.severity === 4;

  return (
    <div
      className={cn(
        "group relative grid grid-cols-[20px_130px_1fr_80px_90px_110px_60px] gap-2 px-4 py-2.5 items-center",
        "hover:bg-coescd-border/40 transition-colors",
        isCritical && "bg-severity-bg-4"
      )}
    >
      {/* Critical pulsing left border */}
      {isCritical && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 critical-pulse-border border-l-2 border-severity-4" />
      )}

      {/* Severity dot */}
      <div className="flex items-center justify-center">
        <span
          className={cn(
            "w-2.5 h-2.5 rounded-full shrink-0",
            severityColors[incident.severity]
          )}
        />
      </div>

      {/* Code */}
      <div>
        <span className="font-mono text-xs text-coescd-primary leading-none">
          {incident.code}
        </span>
        <p className={cn(
          "text-2xs mt-0.5 font-medium",
          incident.severity === 4 && "text-severity-4",
          incident.severity === 3 && "text-severity-3",
          incident.severity === 2 && "text-severity-2",
          incident.severity === 1 && "text-severity-1",
        )}>
          {incident.severityLabel}
        </p>
      </div>

      {/* Title + Location */}
      <div className="min-w-0">
        <p className="text-sm font-medium text-coescd-text truncate leading-tight">
          {incident.title}
        </p>
        <p className="text-xs text-coescd-muted truncate mt-0.5">
          {incident.location}
        </p>
      </div>

      {/* Elapsed */}
      <span className="font-mono text-xs text-coescd-muted">{incident.elapsed}</span>

      {/* Status */}
      <span
        className={cn(
          "text-2xs font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-wider inline-block",
          statusStyles[incident.status]
        )}
      >
        {incident.status}
      </span>

      {/* Commander */}
      <p className="text-xs text-coescd-muted truncate">{incident.commander}</p>

      {/* View link */}
      <a
        href={`/incidents/${incident.id}`}
        className={cn(
          "flex items-center gap-0.5 text-xs text-coescd-subtle hover:text-coescd-primary transition-colors",
          "opacity-0 group-hover:opacity-100"
        )}
      >
        View <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

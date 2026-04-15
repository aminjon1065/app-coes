import { MapPinned, Paperclip, TriangleAlert } from "lucide-react";
import { formatTaskTimestamp, type UserSummary } from "@/lib/api/task-workspace";
import type { IncidentSitrepDto } from "@/lib/api/incident-workspace";

type SitrepCardProps = {
  sitrep: IncidentSitrepDto;
  users?: UserSummary[];
  compact?: boolean;
};

function findReporterName(
  sitrep: IncidentSitrepDto,
  users: UserSummary[] | undefined,
) {
  if (sitrep.reporter?.fullName) {
    return sitrep.reporter.fullName;
  }

  if (!users) {
    return sitrep.reporterId;
  }

  return users.find((user) => user.id === sitrep.reporterId)?.fullName ?? sitrep.reporterId;
}

export function SitrepCard({
  sitrep,
  users,
  compact = false,
}: SitrepCardProps) {
  return (
    <article className="rounded-[22px] border border-cyan-400/20 bg-cyan-400/7 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-white">
            {findReporterName(sitrep, users)}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Reported {formatTaskTimestamp(sitrep.reportedAt)}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {sitrep.severity ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/25 bg-rose-400/10 px-2.5 py-1 text-[11px] font-medium text-rose-100">
              <TriangleAlert className="h-3.5 w-3.5" />
              Severity {sitrep.severity}
            </span>
          ) : null}
          {sitrep.location ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-medium text-slate-200">
              <MapPinned className="h-3.5 w-3.5" />
              {sitrep.location.lat.toFixed(4)}, {sitrep.location.lon.toFixed(4)}
            </span>
          ) : null}
        </div>
      </div>

      <p
        className={`mt-3 text-sm text-slate-300 ${compact ? "leading-6" : "leading-7"}`}
      >
        {sitrep.text}
      </p>

      {sitrep.attachments.length > 0 ? (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs text-slate-300">
          <Paperclip className="h-3.5 w-3.5" />
          {sitrep.attachments.length} attachment
          {sitrep.attachments.length > 1 ? "s" : ""}
        </div>
      ) : null}
    </article>
  );
}

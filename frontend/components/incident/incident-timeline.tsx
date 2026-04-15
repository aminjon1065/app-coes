import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Flag,
  Star,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import {
  formatTaskRelative,
  formatTaskTimestamp,
  type UserSummary,
} from "@/lib/api/task-workspace";
import type {
  IncidentSitrepDto,
  IncidentTimelineDto,
} from "@/lib/api/incident-workspace";

type IncidentTimelineProps = {
  entries: IncidentTimelineDto[];
  sitreps: IncidentSitrepDto[];
  users: UserSummary[];
};

const ENTRY_ICONS: Record<string, LucideIcon> = {
  status_change: Flag,
  severity_change: AlertTriangle,
  commander_assigned: Star,
  participant_joined: UserPlus,
  participant_left: UserMinus,
  sitrep: ClipboardList,
};

function findUserName(users: UserSummary[], userId: string | null | undefined) {
  if (!userId) {
    return "Unknown user";
  }

  return users.find((user) => user.id === userId)?.fullName ?? userId;
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function payloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" ? value : null;
}

function describeTimelineEntry(
  entry: IncidentTimelineDto,
  sitreps: IncidentSitrepDto[],
  users: UserSummary[],
) {
  const actorName = findUserName(users, entry.actorId);

  switch (entry.kind) {
    case "status_change": {
      const before = payloadString(entry.payload, "before");
      const after = payloadString(entry.payload, "after");
      const resolutionSummary = payloadString(entry.payload, "resolutionSummary");
      const reason = payloadString(entry.payload, "reason");

      return {
        title:
          before && after
            ? `Status moved from ${before} to ${after}`
            : "Status updated",
        body: resolutionSummary ?? reason ?? "No additional summary provided.",
        meta: `by ${actorName}`,
      };
    }
    case "severity_change": {
      const before = payloadNumber(entry.payload, "before");
      const after = payloadNumber(entry.payload, "after");
      const reason = payloadString(entry.payload, "reason");

      return {
        title:
          before !== null && after !== null
            ? `Severity changed from ${before} to ${after}`
            : "Severity updated",
        body: reason ?? "No severity rationale provided.",
        meta: `by ${actorName}`,
      };
    }
    case "commander_assigned": {
      const previousCommanderId = payloadString(entry.payload, "previousCommanderId");
      const newCommanderId = payloadString(entry.payload, "newCommanderId");

      return {
        title: `Commander set to ${findUserName(users, newCommanderId)}`,
        body: previousCommanderId
          ? `Previous commander: ${findUserName(users, previousCommanderId)}`
          : "First commander assignment recorded.",
        meta: `by ${actorName}`,
      };
    }
    case "participant_joined":
    case "participant_left": {
      const userId = payloadString(entry.payload, "userId");
      const role = payloadString(entry.payload, "role");

      return {
        title: `${findUserName(users, userId)} ${
          entry.kind === "participant_joined" ? "joined" : "left"
        } the incident`,
        body: role ? `Role: ${role}` : "Role not provided.",
        meta: `by ${actorName}`,
      };
    }
    case "sitrep": {
      const sitrepId = payloadString(entry.payload, "sitrepId");
      const sitrep = sitreps.find((item) => item.id === sitrepId);

      return {
        title: sitrep ? "Situation report submitted" : "Sitrep recorded",
        body:
          sitrep?.text ??
          "The report exists in the timeline, but its body was not loaded into the current feed.",
        meta: sitrep
          ? `reported ${formatTaskRelative(sitrep.reportedAt)} by ${findUserName(users, sitrep.reporterId)}`
          : `by ${actorName}`,
      };
    }
    default:
      return {
        title: entry.kind.replaceAll("_", " "),
        body: "Detailed payload rendering for this event type is not defined yet.",
        meta: `by ${actorName}`,
      };
  }
}

export function IncidentTimeline({
  entries,
  sitreps,
  users,
}: IncidentTimelineProps) {
  return (
    <ol className="relative ml-4 border-l border-white/10">
      {entries.map((entry) => {
        const Icon = ENTRY_ICONS[entry.kind] ?? Activity;
        const summary = describeTimelineEntry(entry, sitreps, users);

        return (
          <li key={entry.id} className="mb-6 ml-6">
            <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[rgba(12,16,26,0.96)] ring-4 ring-[rgba(12,16,26,0.96)]">
              <Icon className="h-3.5 w-3.5 text-slate-300" />
            </span>

            <div className="rounded-[22px] border border-white/10 bg-black/15 px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">{summary.title}</p>
                  <p className="mt-2 text-sm leading-7 text-slate-300">
                    {summary.body}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>{formatTaskTimestamp(entry.ts)}</div>
                  <div className="mt-1">{formatTaskRelative(entry.ts)}</div>
                </div>
              </div>

              <div className="mt-3 text-xs text-slate-500">{summary.meta}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardPlus,
  MapPinned,
  RadioTower,
  ShieldAlert,
  Users,
} from "lucide-react";
import { IncidentTimeline } from "@/components/incident/incident-timeline";
import { SitrepCard } from "@/components/incident/sitrep-card";
import { loadIncidentWorkspace } from "@/lib/api/incident-workspace";
import {
  formatTaskRelative,
  formatTaskTimestamp,
  getDueState,
} from "@/lib/api/task-workspace";

type MobileIncidentPageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileIncidentPage({
  params,
}: MobileIncidentPageProps) {
  const resolvedParams = await params;
  const workspace = await loadIncidentWorkspace({
    incidentId: resolvedParams.id,
  });

  if (!workspace.incident) {
    notFound();
  }

  const { incident } = workspace;
  const topTasks = [
    ...workspace.taskWorkspace.overdueTasks,
    ...workspace.taskWorkspace.myTasks,
  ].slice(0, 3);
  const recentSitrep = workspace.sitreps[0] ?? null;

  return (
    <main className="space-y-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/m"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Mobile home
        </Link>
        <Link
          href={`/m/sitrep/new?incidentId=${incident.id}`}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/12 px-3 py-2 text-sm font-medium text-cyan-50"
        >
          <ClipboardPlus className="h-4 w-4" />
          Sitrep
        </Link>
      </div>

      <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
        <div className="flex items-center gap-2 text-cyan-100">
          <RadioTower className="h-4 w-4" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Incident field view
          </span>
        </div>
        <div className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">
          {incident.code}
        </div>
        <h1 className="mt-2 text-2xl font-medium leading-tight text-white">
          {incident.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {incident.description ?? "No extended description is available in the current feed."}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-100">
            Severity {incident.severity}
          </span>
          <span className="rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-xs text-slate-200">
            {incident.status}
          </span>
          <span className="rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-xs text-slate-200">
            {incident.category}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-[22px] border border-white/10 bg-black/15 p-3">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Commander
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {incident.commander?.fullName ?? "Unassigned"}
            </div>
          </div>
          <div className="rounded-[22px] border border-white/10 bg-black/15 p-3">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Updated
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {formatTaskRelative(incident.updatedAt)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-black/18 p-4">
        <div className="flex items-center gap-2 text-cyan-100">
          <ShieldAlert className="h-4 w-4" />
          <span className="text-sm font-medium">Latest sitrep</span>
        </div>
        <div className="mt-4">
          {recentSitrep ? (
            <SitrepCard
              sitrep={recentSitrep}
              users={workspace.availableUsers}
              compact
            />
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-slate-400">
              No sitrep has been filed yet for this incident.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-black/18 p-4">
        <div className="flex items-center gap-2 text-cyan-100">
          <MapPinned className="h-4 w-4" />
          <span className="text-sm font-medium">Immediate task load</span>
        </div>
        <div className="mt-4 space-y-3">
          {topTasks.length > 0 ? (
            topTasks.map((task) => {
              const due = getDueState(task);

              return (
                <div
                  key={task.id}
                  className="rounded-[22px] border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {task.title}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {task.assignee?.fullName ?? "Unassigned"}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] ${due.tone}`}>
                      {due.label}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                    <span>{task.status}</span>
                    <span>{formatTaskTimestamp(task.updatedAt)}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-slate-400">
              No high-priority task slice is available for this incident.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-black/18 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-cyan-100">
            <Users className="h-4 w-4" />
            <span className="text-sm font-medium">Roster</span>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
            {workspace.participants.length}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {workspace.participants.slice(0, 8).map((participant) => (
            <div
              key={`${participant.incidentId}-${participant.userId}`}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200"
            >
              {participant.user?.fullName ?? participant.userId}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-black/18 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Timeline
            </div>
            <h2 className="mt-2 text-xl font-medium text-white">
              Recent activity
            </h2>
          </div>
          <Link
            href={`/incidents/${incident.id}?tab=overview`}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200"
          >
            Full view
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="mt-4">
          {workspace.timeline.length > 0 ? (
            <IncidentTimeline
              entries={workspace.timeline.slice(0, 6)}
              sitreps={workspace.sitreps}
              users={workspace.availableUsers}
            />
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-slate-400">
              Timeline feed is empty in the current workspace.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

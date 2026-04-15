import Link from "next/link";
import {
  ArrowRight,
  ClipboardPlus,
  Flame,
  ShieldAlert,
} from "lucide-react";
import {
  INCIDENT_SORT_OPTIONS,
  loadIncidentDirectory,
} from "@/lib/api/incident-workspace";
import { formatTaskRelative } from "@/lib/api/task-workspace";

export default async function MobileHomePage() {
  const workspace = await loadIncidentDirectory({
    sort: INCIDENT_SORT_OPTIONS[1]?.value,
  });
  const recentIncidents = workspace.incidents.slice(0, 6);

  return (
    <main className="space-y-5 py-2">
      <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex items-center gap-3 text-cyan-100">
          <ShieldAlert className="h-5 w-5" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Mobile duty
          </span>
        </div>
        <h1 className="mt-3 text-3xl font-medium leading-tight text-white">
          Field incident access and rapid sitrep capture.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Mobile workspace for quick status checks, responder hand-off, and
          camera-first reporting.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Link
            href="/m/sitrep/new"
            className="inline-flex items-center justify-center gap-2 rounded-[22px] border border-cyan-300/30 bg-cyan-300/12 px-4 py-3 text-sm font-medium text-cyan-50"
          >
            <ClipboardPlus className="h-4 w-4" />
            New sitrep
          </Link>
          <Link
            href="/incidents"
            className="inline-flex items-center justify-center gap-2 rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200"
          >
            Full console
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-black/18 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Active incidents
            </p>
            <h2 className="mt-2 text-xl font-medium text-white">
              Recent operational load
            </h2>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
            {workspace.incidents.length}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {recentIncidents.map((incident) => (
            <Link
              key={incident.id}
              href={`/m/incidents/${incident.id}`}
              className="block rounded-[24px] border border-white/10 bg-white/5 p-4 transition hover:bg-white/8"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">
                    {incident.code}
                  </div>
                  <div className="mt-2 text-base font-medium text-white">
                    {incident.title}
                  </div>
                </div>
                <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-xs text-rose-100">
                  Sev {incident.severity}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                <span>{incident.status}</span>
                <span>{formatTaskRelative(incident.updatedAt)}</span>
              </div>
            </Link>
          ))}
          {recentIncidents.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
              Incident feed is empty in the current workspace.
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(58,24,13,0.78),rgba(33,14,14,0.7))] p-4">
        <div className="flex items-center gap-3 text-rose-100">
          <Flame className="h-5 w-5" />
          <span className="text-sm font-medium">Responder mode</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-rose-50/90">
          Keep interaction depth low: open one incident, file one sitrep, and
          return to the field without the full desktop shell.
        </p>
      </section>
    </main>
  );
}

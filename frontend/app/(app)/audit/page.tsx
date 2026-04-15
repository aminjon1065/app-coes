import { Download, ShieldCheck } from "lucide-react";
import { AuditFilters } from "@/components/audit/audit-filters";
import { AuditLogTable } from "@/components/audit/audit-log-table";
import { loadAuditWorkspace } from "@/lib/api/audit-workspace";

type AuditPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const resolvedSearchParams = await searchParams;
  const actorId = firstParam(resolvedSearchParams.actorId);
  const eventType = firstParam(resolvedSearchParams.eventType);
  const targetType = firstParam(resolvedSearchParams.targetType);
  const targetId = firstParam(resolvedSearchParams.targetId);
  const from = firstParam(resolvedSearchParams.from);
  const to = firstParam(resolvedSearchParams.to);
  const workspace = await loadAuditWorkspace({
    actorId,
    eventType,
    targetType,
    targetId,
    from,
    to,
  });

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 text-cyan-100">
              <ShieldCheck className="h-5 w-5" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                Audit trail
              </p>
            </div>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              Security-sensitive changes and operational actions in one immutable feed.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              This view is wired to the backend audit module, supports filtered reads,
              detail inspection, and infinite scroll through cursor pagination.
            </p>
          </div>

          <div className="grid gap-3 sm:min-w-[280px]">
            <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Source
              </div>
              <div className="mt-2 text-sm font-medium text-white">
                {workspace.source === "api" ? "Backend audit API" : "Mock audit feed"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {workspace.events.length} events in current slice
              </div>
            </div>

            <a
              href="#audit-register"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
            >
              <Download className="h-4 w-4" />
              Inspect log stream
            </a>
          </div>
        </div>
      </section>

      <AuditFilters filters={workspace.filters} />

      <div id="audit-register">
        <AuditLogTable
          source={workspace.source}
          initialEvents={workspace.events}
          initialPage={workspace.page}
          filters={workspace.filters}
        />
      </div>
    </main>
  );
}

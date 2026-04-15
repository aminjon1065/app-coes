import type { AuditEventDto } from "@/lib/api/audit-workspace";

type AuditEventDetailProps = {
  event: AuditEventDto;
};

function prettyJson(value: Record<string, unknown> | null) {
  if (!value) {
    return "No data";
  }

  return JSON.stringify(value, null, 2);
}

export function AuditEventDetail({ event }: AuditEventDetailProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Event type
          </div>
          <div className="mt-2 text-sm text-white">{event.eventType}</div>
        </div>
        <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Actor / target
          </div>
          <div className="mt-2 text-sm text-white">
            {event.actorId ?? "system"} → {event.targetType ?? "system"}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/8 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-100/75">
            Before
          </p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-rose-50">
            {prettyJson(event.before)}
          </pre>
        </div>
        <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/8 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-100/75">
            After
          </p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-emerald-50">
            {prettyJson(event.after)}
          </pre>
        </div>
      </div>
    </div>
  );
}

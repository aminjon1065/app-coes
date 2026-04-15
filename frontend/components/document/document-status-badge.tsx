"use client";

import type { DocumentLifecycleState } from "@/lib/api/document-workspace";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<DocumentLifecycleState, string> = {
  DRAFT: "border-slate-300/25 bg-slate-300/10 text-slate-100",
  REVIEW: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  APPROVED: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  PUBLISHED: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
  ARCHIVED: "border-white/10 bg-white/5 text-slate-400",
  REVOKED: "border-rose-300/30 bg-rose-300/10 text-rose-100",
};

export function DocumentStatusBadge({
  state,
  className,
}: {
  state: DocumentLifecycleState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]",
        STATE_STYLES[state],
        className,
      )}
    >
      {state}
    </span>
  );
}

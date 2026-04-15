import Link from "next/link";
import { FileText, ShieldCheck } from "lucide-react";
import { DocumentStatusBadge } from "@/components/document/document-status-badge";
import {
  documentTemplateLabel,
  formatDocumentTimestamp,
  type DocumentDto,
} from "@/lib/api/document-workspace";
import { cn } from "@/lib/utils";

export function DocumentCard({
  document,
  active = false,
}: {
  document: DocumentDto;
  active?: boolean;
}) {
  const approved =
    document.approvals?.filter((approval) => approval.status === "APPROVED").length ?? 0;
  const total = document.approvals?.length ?? 0;

  return (
    <Link
      href={`/documents/${document.id}`}
      className={cn(
        "block rounded-[28px] border p-5 transition",
        active
          ? "border-cyan-300/35 bg-cyan-300/10"
          : "border-white/10 bg-white/5 hover:bg-white/8",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div
            className={cn(
              "mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border",
              active
                ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-100"
                : "border-white/10 bg-black/12 text-slate-300",
            )}
          >
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-medium text-white">{document.title}</h3>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
              {documentTemplateLabel(document.templateCode)}
            </p>
          </div>
        </div>
        <DocumentStatusBadge state={document.lifecycleState} />
      </div>

      <div className="mt-5 grid gap-3 text-sm text-slate-400 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600">
            Version
          </div>
          <div className="mt-1 text-slate-200">
            v{document.currentVersion?.versionNumber ?? document.versions?.[0]?.versionNumber ?? "n/a"}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            Approvals
          </div>
          <div className="mt-1 text-slate-200">
            {total > 0 ? `${approved} / ${total}` : "Not requested"}
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-500">
        Updated {formatDocumentTimestamp(document.updatedAt)}
      </div>
    </Link>
  );
}

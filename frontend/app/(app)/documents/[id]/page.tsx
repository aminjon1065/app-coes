import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ShieldCheck, TimerReset } from "lucide-react";
import { DocumentApprovalPanel } from "@/components/document/document-approval-panel";
import { DocumentList } from "@/components/document/document-list";
import { DocumentStatusBadge } from "@/components/document/document-status-badge";
import { DocumentViewer } from "@/components/document/document-viewer";
import {
  documentTemplateLabel,
  formatDocumentTimestamp,
  loadDocumentWorkspace,
} from "@/lib/api/document-workspace";

type DocumentDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id } = await params;
  const workspace = await loadDocumentWorkspace({ documentId: id });

  if (!workspace.selectedDocument) {
    notFound();
  }

  const document = workspace.selectedDocument;
  const versions = document.versions?.length
    ? document.versions
    : document.currentVersion
      ? [document.currentVersion]
      : [];
  const currentVersion = versions.find((version) => version.id === document.currentVersionId) ?? versions[0] ?? null;

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <Link
          href="/documents"
          className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to documents
        </Link>

        <div className="mt-5 flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 text-cyan-100">
              <FileText className="h-5 w-5" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                Document detail
              </p>
            </div>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              {document.title}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              {documentTemplateLabel(document.templateCode)} · class {document.classification}
              {document.incidentId ? ` · incident ${document.incidentId}` : ""}
            </p>
          </div>

          <DocumentStatusBadge state={document.lifecycleState} />
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-[24px] border border-white/10 bg-black/15 px-4 py-4">
            <div className="flex items-center gap-2 text-cyan-100">
              <TimerReset className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Updated
              </span>
            </div>
            <div className="mt-3 text-sm font-medium text-white">
              {formatDocumentTimestamp(document.updatedAt)}
            </div>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-black/15 px-4 py-4">
            <div className="flex items-center gap-2 text-cyan-100">
              <FileText className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Version
              </span>
            </div>
            <div className="mt-3 text-sm font-medium text-white">
              {currentVersion ? `v${currentVersion.versionNumber}` : "No version"}
            </div>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-black/15 px-4 py-4">
            <div className="flex items-center gap-2 text-cyan-100">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Approvals
              </span>
            </div>
            <div className="mt-3 text-sm font-medium text-white">
              {(document.approvals ?? []).filter((approval) => approval.status === "APPROVED").length}
              {" / "}
              {document.approvals?.length ?? 0}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_390px]">
        <div className="space-y-5">
          <DocumentViewer
            documentId={document.id}
            versionId={currentVersion?.id ?? document.currentVersionId}
            source={workspace.source}
          />

          <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              Versions
            </p>
            <div className="mt-4 space-y-3">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-black/12 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-medium text-white">
                      Version {version.versionNumber}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Rendered {formatDocumentTimestamp(version.renderedAt)}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {Number(version.sizeBytes || 0).toLocaleString()} bytes
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <DocumentApprovalPanel document={document} source={workspace.source} />

          <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              Nearby documents
            </p>
            <div className="mt-4">
              <DocumentList
                documents={workspace.documents.slice(0, 4)}
                selectedDocumentId={document.id}
              />
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

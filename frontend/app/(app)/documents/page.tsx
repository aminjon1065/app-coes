import Link from "next/link";
import { FileStack, FileText, Filter } from "lucide-react";
import { DocumentCreateForm } from "@/components/document/document-create-form";
import { DocumentList } from "@/components/document/document-list";
import {
  DOCUMENT_STATE_OPTIONS,
  DOCUMENT_TEMPLATE_OPTIONS,
  loadDocumentWorkspace,
} from "@/lib/api/document-workspace";

type DocumentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const resolvedSearchParams = await searchParams;
  const state = firstParam(resolvedSearchParams.state);
  const templateCode = firstParam(resolvedSearchParams.templateCode);
  const incidentId = firstParam(resolvedSearchParams.incidentId);
  const workspace = await loadDocumentWorkspace({ state, templateCode, incidentId });

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 text-cyan-100">
              <FileStack className="h-5 w-5" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                Document workspace
              </p>
            </div>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              Generate, review and publish operational documents.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Template-based PDF generation, document lifecycle controls and approval chains
              now sit on top of the backend document module.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Feed
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {workspace.source === "api" ? "Live document API" : "Mock fallback"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {workspace.documents.length} documents
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_390px]">
        <div className="space-y-5">
          <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-cyan-100">
                  <Filter className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
                    Filters
                  </p>
                </div>
                <h2 className="mt-2 text-xl font-medium text-white">Document register</h2>
              </div>
              <Link
                href="/documents"
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10"
              >
                Clear filters
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {DOCUMENT_STATE_OPTIONS.map((option) => (
                <Link
                  key={option}
                  href={`/documents?state=${option}`}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    state === option
                      ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                      : "border-white/10 bg-black/10 text-slate-400 hover:bg-white/8"
                  }`}
                >
                  {option}
                </Link>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {DOCUMENT_TEMPLATE_OPTIONS.map((option) => (
                <Link
                  key={option.code}
                  href={`/documents?templateCode=${option.code}`}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    templateCode === option.code
                      ? "border-amber-300/30 bg-amber-300/10 text-amber-50"
                      : "border-white/10 bg-black/10 text-slate-400 hover:bg-white/8"
                  }`}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          </div>

          <DocumentList documents={workspace.documents} />
        </div>

        <div className="space-y-5">
          <DocumentCreateForm
            disabled={workspace.source !== "api"}
            defaultIncidentId={incidentId}
          />

          <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-5">
            <div className="flex items-center gap-3 text-cyan-100">
              <FileText className="h-5 w-5" />
              <span className="text-sm font-medium">Lifecycle model</span>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Draft documents can be submitted for review. Approval records drive the
              progress bar and successful approval unlocks publish.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

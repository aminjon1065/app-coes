import { DocumentCard } from "@/components/document/document-card";
import type { DocumentDto } from "@/lib/api/document-workspace";

export function DocumentList({
  documents,
  selectedDocumentId,
}: {
  documents: DocumentDto[];
  selectedDocumentId?: string | null;
}) {
  if (documents.length === 0) {
    return (
      <div className="rounded-[30px] border border-dashed border-white/10 bg-black/10 px-6 py-14 text-center text-sm leading-6 text-slate-500">
        No documents match the current filters.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {documents.map((document) => (
        <DocumentCard
          key={document.id}
          document={document}
          active={document.id === selectedDocumentId}
        />
      ))}
    </div>
  );
}

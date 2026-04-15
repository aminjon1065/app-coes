"use client";

import { useEffect, useState } from "react";
import { FileSearch } from "lucide-react";

export function DocumentViewer({
  documentId,
  versionId,
  source,
}: {
  documentId: string;
  versionId: string | null;
  source: "api" | "mock";
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUrl() {
      if (!versionId || source !== "api") {
        setPdfUrl(null);
        return;
      }

      setError(null);

      try {
        const response = await fetch(
          `/api/documents/${documentId}/url?versionId=${versionId}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as { url?: string | null; message?: string };

        if (!response.ok || !body.url) {
          throw new Error(body.message ?? "PDF URL is unavailable.");
        }

        if (!cancelled) {
          setPdfUrl(body.url);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "PDF URL failed.");
        }
      }
    }

    void loadUrl();

    return () => {
      cancelled = true;
    };
  }, [documentId, source, versionId]);

  if (source !== "api") {
    return (
      <div className="flex min-h-[640px] items-center justify-center rounded-[30px] border border-dashed border-white/10 bg-black/10 p-8 text-center">
        <div>
          <FileSearch className="mx-auto h-10 w-10 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-white">PDF preview fallback</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            Connect the frontend to a live backend with MinIO to render presigned PDF previews.
          </p>
        </div>
      </div>
    );
  }

  if (!versionId) {
    return (
      <div className="rounded-[30px] border border-dashed border-white/10 bg-black/10 px-6 py-20 text-center text-sm text-slate-500">
        No rendered version is attached to this document yet.
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[30px] border border-rose-300/25 bg-rose-300/10 px-6 py-8 text-sm text-rose-100">
        {error}
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="min-h-[640px] animate-pulse rounded-[30px] border border-white/10 bg-white/5" />
    );
  }

  return (
    <iframe
      src={pdfUrl}
      className="h-[760px] w-full rounded-[30px] border border-white/10 bg-white"
      title="Document viewer"
    />
  );
}

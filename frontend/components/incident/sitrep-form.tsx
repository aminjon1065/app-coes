"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  startTransition,
} from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  Crosshair,
  Loader2,
  Paperclip,
  SendHorizontal,
  X,
} from "lucide-react";
import {
  INITIAL_INCIDENT_MUTATION_STATE,
  submitIncidentSitrepAction,
  type IncidentMutationState,
} from "@/app/(app)/incidents/[id]/actions";
import { cn } from "@/lib/utils";

type SitrepFormProps = {
  incidentId: string;
  source: "api" | "mock";
  redirectPath: string;
};

type UploadedAttachment = {
  id: string;
  name: string;
  size: number;
  previewUrl?: string;
};

function Feedback({ state }: { state: IncidentMutationState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-[22px] border px-4 py-3 text-sm",
        state.status === "error"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
          : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
      )}
    >
      {state.message}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <SendHorizontal className="h-4 w-4" />
      {pending ? "Submitting sitrep..." : "Submit sitrep"}
    </button>
  );
}

export function SitrepForm({
  incidentId,
  source,
  redirectPath,
}: SitrepFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, formAction] = useActionState(
    submitIncidentSitrepAction,
    INITIAL_INCIDENT_MUTATION_STATE,
  );
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [location, setLocation] = useState<{ lat: string; lon: string }>({
    lat: "",
    lon: "",
  });
  const handledSubmissionId = useRef<string | null>(null);

  useEffect(() => {
    if (
      state.status !== "success" ||
      !state.submissionId ||
      handledSubmissionId.current === state.submissionId
    ) {
      return;
    }

    handledSubmissionId.current = state.submissionId;
    setAttachments((current) => {
      for (const attachment of current) {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      return [];
    });
    setLocation({ lat: "", lon: "" });

    startTransition(() => {
      router.replace(state.redirectTo ?? pathname);
      router.refresh();
    });
  }, [pathname, router, state.redirectTo, state.status, state.submissionId]);

  useEffect(() => {
    return () => {
      for (const attachment of attachments) {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
    };
  }, [attachments]);

  async function handleUpload(file: File | undefined) {
    if (!file || source !== "api") {
      return;
    }

    const data = new FormData();
    data.set("file", file);
    setUploading(true);
    setUploadError("");

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: data,
      });
      const body = (await response.json()) as {
        data?: { id?: string };
        message?: string;
      };

      if (!response.ok || !body.data?.id) {
        throw new Error(body.message ?? "Upload failed.");
      }

      const uploadId = body.data.id;

      setAttachments((current) => [
        ...current,
        {
          id: uploadId,
          name: file.name,
          size: file.size,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        },
      ]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== id);
    });
  }

  function requestLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setUploadError("Geolocation is not available in this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude.toFixed(6),
          lon: position.coords.longitude.toFixed(6),
        });
        setUploadError("");
      },
      (error) => {
        setUploadError(error.message || "Unable to read current location.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]"
    >
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <input
        type="hidden"
        name="attachments"
        value={attachments.map((attachment) => attachment.id).join(",")}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Sitrep submission
          </p>
          <h2 className="mt-2 text-2xl font-medium text-white">
            Push the next field update
          </h2>
          <p className="mt-2 text-sm leading-7 text-slate-300">
            Record current conditions, optional location, and supporting files.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {source === "api" ? "Live write path" : "Mock mode"}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Report text
          </label>
          <textarea
            name="text"
            required
            rows={5}
            disabled={source !== "api"}
            placeholder="Water level continues to rise. Evacuation of sector B has started."
            className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-7 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Severity
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center justify-center rounded-2xl border border-white/10 bg-black/15 px-3 py-3 text-sm text-slate-200 transition hover:bg-white/10"
                >
                  <input
                    type="radio"
                    name="severity"
                    value={value}
                    disabled={source !== "api"}
                    className="sr-only"
                  />
                  {value}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Evidence
            </label>
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/10",
                source !== "api" && "cursor-not-allowed opacity-60",
              )}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              {uploading ? "Uploading..." : "Attach file"}
              <input
                type="file"
                className="hidden"
                disabled={source !== "api" || uploading}
                onChange={(event) => void handleUpload(event.target.files?.[0])}
              />
            </label>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Latitude
            </label>
            <input
              name="lat"
              value={location.lat}
              onChange={(event) =>
                setLocation((current) => ({ ...current, lat: event.target.value }))
              }
              disabled={source !== "api"}
              placeholder="38.559800"
              className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Longitude
            </label>
            <input
              name="lon"
              value={location.lon}
              onChange={(event) =>
                setLocation((current) => ({ ...current, lon: event.target.value }))
              }
              disabled={source !== "api"}
              placeholder="68.787000"
              className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
          <button
            type="button"
            onClick={requestLocation}
            disabled={source !== "api"}
            className="inline-flex items-center justify-center gap-2 self-end rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Crosshair className="h-4 w-4" />
            Use current
          </button>
        </div>

        {attachments.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="rounded-[22px] border border-white/10 bg-black/15 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {attachment.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {(attachment.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {attachment.previewUrl ? (
                  <div className="relative mt-3 h-32 w-full overflow-hidden rounded-2xl">
                    <Image
                      src={attachment.previewUrl}
                      alt={attachment.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {source !== "api" ? (
          <div className="rounded-[22px] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-50">
            Sitrep submission is disabled because the incident page is currently using the mock fallback workspace.
          </div>
        ) : null}

        {uploadError ? (
          <div className="rounded-[22px] border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {uploadError}
          </div>
        ) : null}

        <Feedback state={state} />
        <SubmitButton />
      </div>
    </form>
  );
}

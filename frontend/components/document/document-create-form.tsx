"use client";

import { useActionState, useEffect, useState, startTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { FilePlus2 } from "lucide-react";
import {
  createDocumentAction,
  INITIAL_DOCUMENT_MUTATION_STATE,
} from "@/app/(app)/documents/actions";
import { DOCUMENT_TEMPLATE_OPTIONS } from "@/lib/api/document-workspace";
import { cn } from "@/lib/utils";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <FilePlus2 className="h-4 w-4" />
      {pending ? "Creating" : "Create document"}
    </button>
  );
}

export function DocumentCreateForm({
  disabled = false,
  defaultIncidentId,
}: {
  disabled?: boolean;
  defaultIncidentId?: string | null;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    createDocumentAction,
    INITIAL_DOCUMENT_MUTATION_STATE,
  );
  const [templateCode, setTemplateCode] = useState(DOCUMENT_TEMPLATE_OPTIONS[0].code);
  const handledSubmissionId = useRef<string | null>(null);
  const template = DOCUMENT_TEMPLATE_OPTIONS.find((item) => item.code === templateCode);

  useEffect(() => {
    if (
      state.status !== "success" ||
      !state.submissionId ||
      handledSubmissionId.current === state.submissionId
    ) {
      return;
    }

    handledSubmissionId.current = state.submissionId;

    startTransition(() => {
      if (state.redirectTo) {
        router.push(state.redirectTo);
      }
      router.refresh();
    });
  }, [router, state.redirectTo, state.status, state.submissionId]);

  return (
    <form action={formAction} className="rounded-[30px] border border-white/10 bg-white/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
        New document
      </p>
      <h2 className="mt-2 text-xl font-medium text-white">Generate from template</h2>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Title
          </span>
          <input
            name="title"
            disabled={disabled}
            placeholder="Initial field assessment"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35 disabled:cursor-not-allowed"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Template
          </span>
          <select
            name="templateCode"
            value={templateCode}
            disabled={disabled}
            onChange={(event) =>
              setTemplateCode(event.target.value as typeof templateCode)
            }
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35 disabled:cursor-not-allowed"
          >
            {DOCUMENT_TEMPLATE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Incident ID
            </span>
            <input
              name="incidentId"
              defaultValue={defaultIncidentId ?? ""}
              disabled={disabled}
              placeholder="Optional UUID"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35 disabled:cursor-not-allowed"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Classification
            </span>
            <select
              name="classification"
              disabled={disabled}
              defaultValue="1"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35 disabled:cursor-not-allowed"
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  Class {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        {template?.fields.map((field) => (
          <label key={field} className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {field}
            </span>
            <textarea
              name={`templateVars.${field}`}
              disabled={disabled}
              rows={3}
              className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35 disabled:cursor-not-allowed"
            />
          </label>
        ))}

        {state.status === "error" ? (
          <div className="rounded-2xl border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {state.message}
          </div>
        ) : null}

        {disabled ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
            Create is disabled in mock fallback mode.
          </div>
        ) : null}

        <div className={cn(disabled && "pointer-events-none opacity-50")}>
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}

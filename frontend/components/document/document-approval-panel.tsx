"use client";

import { useActionState, useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Stamp, XCircle } from "lucide-react";
import {
  approveDocumentAction,
  INITIAL_DOCUMENT_MUTATION_STATE,
  publishDocumentAction,
  rejectDocumentAction,
  submitDocumentReviewAction,
  type DocumentMutationState,
} from "@/app/(app)/documents/actions";
import type { DocumentDto } from "@/lib/api/document-workspace";
import { formatDocumentTimestamp } from "@/lib/api/document-workspace";
import { cn } from "@/lib/utils";

function ActionButton({
  label,
  pendingLabel,
  tone = "cyan",
}: {
  label: string;
  pendingLabel: string;
  tone?: "cyan" | "rose" | "emerald";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
        tone === "rose"
          ? "border-rose-300/30 bg-rose-300/10 text-rose-100 hover:bg-rose-300/16"
          : tone === "emerald"
            ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/16"
            : "border-cyan-300/30 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/16",
      )}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function useDocumentMutation(state: DocumentMutationState) {
  const router = useRouter();
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

    startTransition(() => {
      if (state.redirectTo) {
        router.replace(state.redirectTo);
      }
      router.refresh();
    });
  }, [router, state.redirectTo, state.status, state.submissionId]);
}

function MutationFeedback({ state }: { state: DocumentMutationState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        state.status === "error"
          ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
          : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
      )}
    >
      {state.message}
    </div>
  );
}

export function DocumentApprovalPanel({
  document,
  source,
}: {
  document: DocumentDto;
  source: "api" | "mock";
}) {
  const [submitState, submitAction] = useActionState(
    submitDocumentReviewAction,
    INITIAL_DOCUMENT_MUTATION_STATE,
  );
  const [approveState, approveAction] = useActionState(
    approveDocumentAction,
    INITIAL_DOCUMENT_MUTATION_STATE,
  );
  const [rejectState, rejectAction] = useActionState(
    rejectDocumentAction,
    INITIAL_DOCUMENT_MUTATION_STATE,
  );
  const [publishState, publishAction] = useActionState(
    publishDocumentAction,
    INITIAL_DOCUMENT_MUTATION_STATE,
  );
  const approvals = document.approvals ?? [];
  const approvedCount = approvals.filter((approval) => approval.status === "APPROVED").length;
  const progress = approvals.length > 0 ? (approvedCount / approvals.length) * 100 : 0;
  const disabled = source !== "api";

  useDocumentMutation(submitState);
  useDocumentMutation(approveState);
  useDocumentMutation(rejectState);
  useDocumentMutation(publishState);

  return (
    <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Approval chain
          </p>
          <h2 className="mt-2 text-xl font-medium text-white">
            {approvedCount} / {approvals.length} approvals complete
          </h2>
        </div>
        <Stamp className="h-5 w-5 text-cyan-100" />
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-5 space-y-3">
        {approvals.length > 0 ? (
          approvals.map((approval) => (
            <div
              key={approval.id}
              className="rounded-[22px] border border-white/10 bg-black/12 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">
                    {approval.approver?.fullName ??
                      approval.approver?.email ??
                      approval.approverId}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {approval.signedAt
                      ? `Signed ${formatDocumentTimestamp(approval.signedAt)}`
                      : "Awaiting signature"}
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                    approval.status === "APPROVED"
                      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                      : approval.status === "REJECTED"
                        ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
                        : "border-amber-300/30 bg-amber-300/10 text-amber-100",
                  )}
                >
                  {approval.status}
                </span>
              </div>
              {approval.comment ? (
                <p className="mt-3 text-sm leading-6 text-slate-300">{approval.comment}</p>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-[22px] border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center text-sm text-slate-500">
            Submit the document for review to generate approver records.
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {document.lifecycleState === "DRAFT" ? (
          <form action={submitAction}>
            <input type="hidden" name="documentId" value={document.id} />
            <ActionButton label="Submit for review" pendingLabel="Submitting" />
          </form>
        ) : null}

        {document.lifecycleState === "REVIEW" ? (
          <div className="grid gap-3">
            <form action={approveAction} className="space-y-3">
              <input type="hidden" name="documentId" value={document.id} />
              <textarea
                name="comment"
                placeholder="Approval comment"
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-emerald-300/35"
              />
              <ActionButton label="Approve" pendingLabel="Approving" tone="emerald" />
            </form>
            <form action={rejectAction} className="space-y-3">
              <input type="hidden" name="documentId" value={document.id} />
              <textarea
                name="comment"
                placeholder="Rejection reason"
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-rose-300/35"
              />
              <ActionButton label="Reject" pendingLabel="Rejecting" tone="rose" />
            </form>
          </div>
        ) : null}

        {document.lifecycleState === "APPROVED" ? (
          <form action={publishAction}>
            <input type="hidden" name="documentId" value={document.id} />
            <ActionButton label="Publish" pendingLabel="Publishing" tone="emerald" />
          </form>
        ) : null}

        {disabled ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            Write actions are disabled in mock fallback mode.
          </div>
        ) : null}

        {[submitState, approveState, rejectState, publishState].map((state) => (
          <MutationFeedback key={state.submissionId ?? state.message} state={state} />
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3 text-xs text-slate-500">
        <CheckCircle2 className="h-4 w-4 text-emerald-200" />
        Approve moves pending records forward.
        <XCircle className="h-4 w-4 text-rose-200" />
        Reject returns to draft.
      </div>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { PhoneCall } from "lucide-react";
import {
  INITIAL_CALL_MUTATION_STATE,
  startCallAction,
} from "@/app/(app)/chat/actions";
import type { CallSessionState } from "@/lib/api/call-workspace";

export function CallInviteButton({
  channelId,
  incidentId,
  title,
  disabled = false,
  onStarted,
}: {
  channelId: string | null;
  incidentId?: string | null;
  title: string;
  disabled?: boolean;
  onStarted: (session: CallSessionState) => void;
}) {
  const [state, formAction] = useActionState(
    startCallAction,
    INITIAL_CALL_MUTATION_STATE,
  );
  const handledSubmissionId = useRef<string | null>(null);

  useEffect(() => {
    if (
      state.status !== "success" ||
      !state.submissionId ||
      handledSubmissionId.current === state.submissionId ||
      !state.call
    ) {
      return;
    }

    handledSubmissionId.current = state.submissionId;
    onStarted(state.call);
  }, [onStarted, state.call, state.status, state.submissionId]);

  return (
    <form action={formAction}>
      <input type="hidden" name="channelId" value={channelId ?? ""} />
      <input type="hidden" name="incidentId" value={incidentId ?? ""} />
      <input type="hidden" name="title" value={title} />
      <button
        type="submit"
        disabled={disabled || !channelId}
        className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <PhoneCall className="h-4 w-4" />
        Start call
      </button>
    </form>
  );
}

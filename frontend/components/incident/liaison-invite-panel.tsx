"use client";

import { useActionState, useEffect, useRef } from "react";
import { ExternalLink, Link2, Orbit } from "lucide-react";
import {
  createLiaisonInvitationAction,
  INITIAL_LIAISON_INVITE_MUTATION_STATE,
  type LiaisonInviteMutationState,
} from "@/app/(app)/incidents/[id]/actions";
import { cn } from "@/lib/utils";

function Feedback({ state }: { state: LiaisonInviteMutationState }) {
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

export function LiaisonInvitePanel({
  tenantId,
  incidentId,
  disabled = false,
}: {
  tenantId: string | null | undefined;
  incidentId: string;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(
    createLiaisonInvitationAction,
    INITIAL_LIAISON_INVITE_MUTATION_STATE,
  );
  const handledUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!state.inviteUrl || handledUrl.current === state.inviteUrl) {
      return;
    }

    handledUrl.current = state.inviteUrl;
  }, [state.inviteUrl]);

  return (
    <section className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(14,24,38,0.94),rgba(16,33,48,0.86))] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-3 text-cyan-100">
        <Orbit className="h-5 w-5" />
        <span className="text-sm font-medium">Inter-agency liaison</span>
      </div>
      <p className="mt-3 text-sm leading-7 text-slate-300">
        Invite an external coordination contact into this incident scope and
        generate a one-time acceptance link.
      </p>

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="incidentId" value={incidentId} />
        <input type="hidden" name="tenantId" value={tenantId ?? ""} />

        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Liaison email
          </label>
          <input
            name="email"
            type="email"
            required
            disabled={disabled || !tenantId}
            placeholder="liaison@agency.local"
            className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Extra incident scope
          </label>
          <input
            name="additionalIncidentScope"
            disabled={disabled || !tenantId}
            placeholder="Optional additional incident UUIDs, comma-separated"
            className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <Feedback state={state} />

        {state.inviteUrl ? (
          <div className="rounded-[22px] border border-cyan-300/30 bg-cyan-300/10 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-cyan-50">
              <Link2 className="h-4 w-4" />
              Invitation link
            </div>
            <div className="mt-3 break-all rounded-[18px] border border-white/10 bg-black/20 px-3 py-3 text-xs text-slate-200">
              {state.inviteUrl}
            </div>
            <a
              href={state.inviteUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-sm text-cyan-100 transition hover:text-white"
            >
              Open acceptance page <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={disabled || !tenantId}
          className="inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Create invitation
        </button>
      </form>
    </section>
  );
}

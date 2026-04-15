"use client";

import { useActionState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import {
  acceptInvitationAction,
  INITIAL_INVITE_ACCEPT_STATE,
} from "@/app/accept-invite/actions";
import { cn } from "@/lib/utils";

type ResolvedInvitation = {
  email: string;
  roleCode: string;
  incidentScope: string[];
  expiresAt: string;
  acceptedAt: string | null;
};

export function AcceptInviteForm({
  token,
  invitation,
}: {
  token: string;
  invitation: ResolvedInvitation | null;
}) {
  const [state, formAction] = useActionState(
    acceptInvitationAction,
    INITIAL_INVITE_ACCEPT_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="rounded-[24px] border border-white/10 bg-black/15 p-4">
        <div className="flex items-center gap-2 text-cyan-100">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-sm font-medium">Invitation scope</span>
        </div>
        <div className="mt-3 text-sm leading-6 text-slate-300">
          Role: {invitation?.roleCode ?? "agency_liaison"}
        </div>
        <div className="mt-1 text-sm leading-6 text-slate-300">
          Incident scope: {invitation?.incidentScope.length ?? 0}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          Email
        </label>
        <input
          name="email"
          type="email"
          required
          defaultValue={invitation?.email ?? ""}
          className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          Full name
        </label>
        <input
          name="fullName"
          required
          placeholder="Agency Liaison"
          className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          Phone
        </label>
        <input
          name="phone"
          placeholder="+992900000009"
          className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          Password
        </label>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="Create a password"
          className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
        />
      </div>

      {state.message ? (
        <div
          className={cn(
            "rounded-[22px] border px-4 py-3 text-sm",
            state.status === "error"
              ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
              : state.status === "success"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                : "border-white/10 bg-white/5 text-slate-300",
          )}
        >
          {state.message}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={!invitation || invitation.acceptedAt !== null}
        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Accept invitation
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}

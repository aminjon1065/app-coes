"use client";

import { useActionState, useEffect, useMemo, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import {
  activateBreakGlassAction,
  INITIAL_ADMIN_MUTATION_STATE,
} from "@/app/(app)/admin/actions";
import type { AdminCurrentUser, AdminUserDto } from "@/lib/api/admin-workspace";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-2.5 text-sm font-medium text-amber-50 transition hover:bg-amber-300/16 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <ShieldAlert className="h-4 w-4" />
      {pending ? "Granting temporary access..." : "Activate break-glass"}
    </button>
  );
}

export function BreakGlassPanel({
  currentUser,
  users,
  disabled = false,
}: {
  currentUser: AdminCurrentUser;
  users: AdminUserDto[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    activateBreakGlassAction,
    INITIAL_ADMIN_MUTATION_STATE,
  );
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
      router.refresh();
    });
  }, [router, state.status, state.submissionId]);

  const isPlatformAdmin = currentUser.roles.includes("platform_admin");
  const roleOptions = useMemo(
    () =>
      isPlatformAdmin
        ? [
            { value: "incident_commander", label: "Incident commander" },
            { value: "shift_lead", label: "Shift lead" },
            { value: "tenant_admin", label: "Tenant admin" },
          ]
        : [{ value: "incident_commander", label: "Incident commander" }],
    [isPlatformAdmin],
  );
  const eligibleUsers = useMemo(
    () =>
      users.filter(
        (user) => user.id !== currentUser.id && user.status === "active",
      ),
    [currentUser.id, users],
  );

  return (
    <section className="rounded-[30px] border border-amber-300/20 bg-[linear-gradient(135deg,rgba(44,28,10,0.82),rgba(27,19,10,0.88))] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-100/70">
        Break-glass
      </p>
      <h2 className="mt-2 text-xl font-medium text-white">
        Temporary emergency elevation
      </h2>
      <p className="mt-3 text-sm leading-7 text-slate-300">
        Use only for time-bounded operational escalation. The backend enforces a
        maximum duration of four hours and writes audit entries for activation
        and automatic revocation.
      </p>

      <form action={formAction} className="mt-5 space-y-4">
        <select
          name="targetUserId"
          disabled={disabled}
          defaultValue=""
          className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none focus:border-amber-300/35 disabled:cursor-not-allowed"
        >
          <option value="" disabled>
            Select active operator
          </option>
          {eligibleUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.fullName} · {user.email}
            </option>
          ))}
        </select>

        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <select
            name="roleCode"
            disabled={disabled}
            defaultValue={roleOptions[0]?.value}
            className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none focus:border-amber-300/35 disabled:cursor-not-allowed"
          >
            {roleOptions.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>

          <select
            name="durationHours"
            disabled={disabled}
            defaultValue="4"
            className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none focus:border-amber-300/35 disabled:cursor-not-allowed"
          >
            {[1, 2, 3, 4].map((hours) => (
              <option key={hours} value={hours}>
                {hours}h
              </option>
            ))}
          </select>
        </div>

        <textarea
          name="reason"
          disabled={disabled}
          rows={4}
          placeholder="Operational justification for temporary elevation"
          className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-amber-300/35 disabled:cursor-not-allowed"
        />

        {state.status === "error" ? (
          <div className="rounded-2xl border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {state.message}
          </div>
        ) : null}

        {state.status === "success" ? (
          <div className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
            {state.message}
          </div>
        ) : null}

        {disabled ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
            Break-glass mutation is unavailable in fallback mode or without the required role.
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-black/16 px-4 py-3 text-sm text-slate-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-200" />
            <span>
              `shift_lead` can only grant temporary `incident_commander`. `platform_admin`
              can also issue `shift_lead` or `tenant_admin` for emergency recovery.
            </span>
          </div>
        </div>

        <SubmitButton disabled={disabled || eligibleUsers.length === 0} />
      </form>
    </section>
  );
}

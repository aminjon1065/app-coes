"use client";

import { useActionState, useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { UserPlus2 } from "lucide-react";
import {
  createAdminUserAction,
  INITIAL_ADMIN_MUTATION_STATE,
} from "@/app/(app)/admin/actions";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <UserPlus2 className="h-4 w-4" />
      {pending ? "Creating user..." : "Create user"}
    </button>
  );
}

export function UserForm({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    createAdminUserAction,
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

  return (
    <form action={formAction} className="rounded-[30px] border border-white/10 bg-white/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
        New user
      </p>
      <h2 className="mt-2 text-xl font-medium text-white">Provision tenant account</h2>

      <div className="mt-5 space-y-4">
        <input
          name="fullName"
          disabled={disabled}
          placeholder="Full name"
          className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35 disabled:cursor-not-allowed"
        />
        <input
          name="email"
          type="email"
          disabled={disabled}
          placeholder="Email"
          className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35 disabled:cursor-not-allowed"
        />
        <input
          name="phone"
          disabled={disabled}
          placeholder="Phone (optional)"
          className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35 disabled:cursor-not-allowed"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            name="password"
            type="password"
            disabled={disabled}
            placeholder="Temporary password"
            className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35 disabled:cursor-not-allowed"
          />
          <select
            name="clearance"
            disabled={disabled}
            defaultValue="1"
            className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35 disabled:cursor-not-allowed"
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                Clearance {value}
              </option>
            ))}
          </select>
        </div>

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
            Create is disabled while admin uses the mock fallback workspace.
          </div>
        ) : null}

        <SubmitButton disabled={disabled} />
      </div>
    </form>
  );
}

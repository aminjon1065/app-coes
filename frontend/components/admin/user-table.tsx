"use client";

import { useActionState, useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { ShieldCheck, Trash2 } from "lucide-react";
import {
  deleteAdminUserAction,
  INITIAL_ADMIN_MUTATION_STATE,
} from "@/app/(app)/admin/actions";
import type { AdminUserDto } from "@/lib/api/admin-workspace";
import { formatTaskTimestamp } from "@/lib/api/task-workspace";

function DeleteButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex items-center gap-2 rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-400/16 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Trash2 className="h-3.5 w-3.5" />
      {pending ? "Removing..." : "Delete"}
    </button>
  );
}

export function UserTable({
  users,
  disabled = false,
}: {
  users: AdminUserDto[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    deleteAdminUserAction,
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
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            User register
          </p>
          <h2 className="mt-2 text-2xl font-medium text-white">Tenant users</h2>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {users.length} accounts
        </div>
      </div>

      {state.status === "error" ? (
        <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
          {state.message}
        </div>
      ) : null}

      {state.status === "success" ? (
        <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
          {state.message}
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              <th className="px-4 py-2">Full Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Clearance</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last Login</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="bg-black/15 text-sm text-slate-200">
                <td className="rounded-l-[20px] px-4 py-3">
                  <div className="font-medium text-white">{user.fullName}</div>
                  <div className="mt-1 text-xs text-slate-500">{user.phone ?? "No phone"}</div>
                </td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-medium text-cyan-50">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {user.clearance}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                    {user.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {user.lastLoginAt ? formatTaskTimestamp(user.lastLoginAt) : "Never"}
                </td>
                <td className="rounded-r-[20px] px-4 py-3 text-right">
                  <form action={formAction} className="inline-flex">
                    <input type="hidden" name="userId" value={user.id} />
                    <DeleteButton disabled={disabled} />
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

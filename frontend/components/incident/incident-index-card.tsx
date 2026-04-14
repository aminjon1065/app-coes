"use client";

import {
  useActionState,
  useEffect,
  useRef,
  startTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { ArrowRight, RadioTower } from "lucide-react";
import {
  INITIAL_INCIDENT_INDEX_MUTATION_STATE,
  openIncidentFromIndexAction,
  raiseIncidentSeverityFromIndexAction,
  type IncidentIndexMutationState,
} from "@/app/(app)/incidents/actions";
import { type IncidentDto } from "@/lib/api/incident-workspace";
import { formatTaskRelative } from "@/lib/api/task-workspace";
import { cn } from "@/lib/utils";

type IncidentIndexCardProps = {
  incident: IncidentDto;
};

function getIncidentHref(id: string, tab: "overview" | "tasks" = "overview") {
  return `/incidents/${id}?tab=${tab}`;
}

function useIncidentIndexMutation(
  action: (
    previousState: IncidentIndexMutationState,
    formData: FormData,
  ) => Promise<IncidentIndexMutationState>,
) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, formAction] = useActionState(
    action,
    INITIAL_INCIDENT_INDEX_MUTATION_STATE,
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
      router.replace(state.redirectTo ?? pathname);
      router.refresh();
    });
  }, [pathname, router, state.redirectTo, state.status, state.submissionId]);

  return { state, formAction };
}

function Feedback({ state }: { state: IncidentIndexMutationState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-[20px] border px-3 py-2 text-sm",
        state.status === "error"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
          : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
      )}
    >
      {state.message}
    </div>
  );
}

function QuickSubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-sm text-amber-50 transition hover:bg-amber-300/14 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function IncidentIndexCard({ incident }: IncidentIndexCardProps) {
  const searchParams = useSearchParams();
  const currentPath = searchParams?.toString()
    ? `/incidents?${searchParams.toString()}`
    : "/incidents";
  const activateMutation = useIncidentIndexMutation(openIncidentFromIndexAction);
  const severityMutation = useIncidentIndexMutation(
    raiseIncidentSeverityFromIndexAction,
  );
  const canRaiseSeverity =
    incident.status !== "closed" &&
    incident.status !== "archived" &&
    incident.severity < 4;

  return (
    <article className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            {incident.code}
          </div>
          <h2 className="mt-2 text-xl font-medium text-white">
            {incident.title}
          </h2>
        </div>
        <div className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-100">
          Sev {incident.severity}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-slate-300">
          {incident.status}
        </span>
        <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-slate-300">
          {incident.category}
        </span>
        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1 text-cyan-100">
          Updated {formatTaskRelative(incident.updatedAt)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-400">
        <span>Commander: {incident.commander?.fullName ?? "Unassigned"}</span>
        <span>
          Classification {incident.classification}
        </span>
      </div>

      <p className="mt-4 text-sm leading-7 text-slate-300">
        {incident.description ??
          "Description is not available in the current feed yet, but the detail workspace is ready."}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={getIncidentHref(incident.id, "overview")}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/10"
        >
          Open overview <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href={getIncidentHref(incident.id, "tasks")}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
        >
          Open tasks <RadioTower className="h-4 w-4" />
        </Link>
      </div>

      {(incident.status === "draft" || canRaiseSeverity) ? (
        <div className="mt-5 space-y-3 rounded-[24px] border border-white/10 bg-black/10 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Quick actions
          </div>

          <div className="flex flex-wrap gap-2">
            {incident.status === "draft" ? (
              <form action={activateMutation.formAction}>
                <input type="hidden" name="incidentId" value={incident.id} />
                <input type="hidden" name="redirectPath" value={currentPath} />
                <QuickSubmitButton
                  label="Activate draft"
                  pendingLabel="Opening draft..."
                />
              </form>
            ) : null}

            {canRaiseSeverity ? (
              <form action={severityMutation.formAction}>
                <input type="hidden" name="incidentId" value={incident.id} />
                <input type="hidden" name="redirectPath" value={currentPath} />
                <input
                  type="hidden"
                  name="targetSeverity"
                  value={String(Math.min(4, incident.severity + 1))}
                />
                <input
                  type="hidden"
                  name="reason"
                  value="Quick severity raise from incident index."
                />
                <QuickSubmitButton
                  label={`Raise to Sev ${Math.min(4, incident.severity + 1)}`}
                  pendingLabel="Updating severity..."
                />
              </form>
            ) : null}
          </div>

          <Feedback state={activateMutation.state} />
          <Feedback state={severityMutation.state} />
        </div>
      ) : null}
    </article>
  );
}

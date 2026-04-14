"use client";

import type { ReactNode } from "react";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  startTransition,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  addIncidentParticipantAction,
  assignIncidentCommanderAction,
  changeIncidentSeverityAction,
  INITIAL_INCIDENT_MUTATION_STATE,
  type IncidentMutationState,
  removeIncidentParticipantAction,
  submitIncidentSitrepAction,
  transitionIncidentAction,
} from "@/app/(app)/incidents/[id]/actions";
import {
  type AvailableIncidentTransitionDto,
  type IncidentDto,
  type IncidentParticipantDto,
} from "@/lib/api/incident-workspace";
import { type UserSummary } from "@/lib/api/task-workspace";
import { cn } from "@/lib/utils";

type IncidentCommandPanelProps = {
  source: "api" | "mock";
  incident: IncidentDto;
  availableTransitions: AvailableIncidentTransitionDto[];
  availableUsers: UserSummary[];
  participants: IncidentParticipantDto[];
  redirectPath: string;
};

function useIncidentMutation(
  action: (
    previousState: IncidentMutationState,
    formData: FormData,
  ) => Promise<IncidentMutationState>,
) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, formAction] = useActionState(
    action,
    INITIAL_INCIDENT_MUTATION_STATE,
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

function Section({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)]"
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              {title}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{subtitle}</p>
          </div>
          <span className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
            Open
          </span>
        </div>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}

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

function Label({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
        {label}
      </span>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </div>
  );
}

function SubmitButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function TransitionButton({
  code,
  label,
  requires,
}: {
  code: string;
  label: string;
  requires: string[];
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="transition"
      value={code}
      disabled={pending}
      className={cn(
        "flex min-h-20 flex-col items-start justify-between rounded-[22px] border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
        requires.length > 0
          ? "border-amber-300/30 bg-amber-300/10 text-amber-50 hover:bg-amber-300/14"
          : "border-sky-300/30 bg-sky-300/10 text-sky-50 hover:bg-sky-300/14",
      )}
    >
      <span className="text-sm font-medium">{pending ? "Submitting..." : label}</span>
      <span className="text-[11px] uppercase tracking-[0.24em] text-white/55">
        {requires.length > 0 ? requires.join(" + ") : "Direct"}
      </span>
    </button>
  );
}

function WriteGuard({
  source,
  children,
}: {
  source: "api" | "mock";
  children: ReactNode;
}) {
  if (source === "api") {
    return <>{children}</>;
  }

  return (
    <div className="rounded-[24px] border border-amber-300/25 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
      Incident write actions are disabled because this page is currently using
      the mock fallback workspace.
    </div>
  );
}

export function IncidentCommandPanel({
  source,
  incident,
  availableTransitions,
  availableUsers,
  participants,
  redirectPath,
}: IncidentCommandPanelProps) {
  const transitionMutation = useIncidentMutation(transitionIncidentAction);
  const severityMutation = useIncidentMutation(changeIncidentSeverityAction);
  const commanderMutation = useIncidentMutation(assignIncidentCommanderAction);
  const addParticipantMutation = useIncidentMutation(addIncidentParticipantAction);
  const removeParticipantMutation = useIncidentMutation(
    removeIncidentParticipantAction,
  );
  const sitrepMutation = useIncidentMutation(submitIncidentSitrepAction);
  const [commanderUserId, setCommanderUserId] = useState(
    incident.commanderId ?? "",
  );
  const [participantUserId, setParticipantUserId] = useState("");

  const activeParticipantIds = new Set(participants.map((item) => item.userId));
  const participantCandidates = availableUsers.filter(
    (user) => !activeParticipantIds.has(user.id),
  );

  return (
    <aside className="space-y-6">
      <section className="rounded-[32px] border border-white/10 bg-[rgba(12,16,26,0.88)] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.2)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-200/70">
          Incident command rail
        </p>
        <h2 className="mt-3 text-2xl font-medium text-white">
          Manage status, severity, command ownership, and roster changes here.
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          These controls target the incident slice directly and keep the detail
          page usable as the command workspace.
        </p>
      </section>

      <Section
        title="Status transition"
        subtitle="Available transitions come from the backend incident policy."
        defaultOpen
      >
        <WriteGuard source={source}>
          <form action={transitionMutation.formAction} className="space-y-4">
            <input type="hidden" name="incidentId" value={incident.id} />
            <input type="hidden" name="redirectPath" value={redirectPath} />

            {availableTransitions.length > 0 ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {availableTransitions.map((transition) => (
                    <TransitionButton
                      key={transition.code}
                      code={transition.code}
                      label={transition.label}
                      requires={transition.requires}
                    />
                  ))}
                </div>

                <div className="space-y-2">
                  <Label
                    label="Reason"
                    hint="Used for escalate, contain, reopen, de-escalate"
                  />
                  <textarea
                    name="reason"
                    rows={3}
                    placeholder="Provide operational justification when required."
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                  />
                </div>

                <div className="space-y-2">
                  <Label
                    label="Resolution summary"
                    hint="Required for close"
                  />
                  <textarea
                    name="resolutionSummary"
                    rows={4}
                    placeholder="Summarize closure conditions, demobilization, and final state."
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                  />
                </div>
              </>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
                No incident transitions are currently available.
              </div>
            )}

            <Feedback state={transitionMutation.state} />
          </form>
        </WriteGuard>
      </Section>

      <Section
        title="Severity"
        subtitle="Escalate or reduce severity with an audit reason."
      >
        <WriteGuard source={source}>
          <form action={severityMutation.formAction} className="space-y-4">
            <input type="hidden" name="incidentId" value={incident.id} />
            <input type="hidden" name="redirectPath" value={redirectPath} />

            <div className="space-y-2">
              <Label label="Severity" />
              <select
                name="severity"
                defaultValue={String(incident.severity)}
                className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
              >
                <option value="1">1 · Low</option>
                <option value="2">2 · Elevated</option>
                <option value="3">3 · High</option>
                <option value="4">4 · Critical</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label label="Reason" />
              <textarea
                name="reason"
                required
                rows={3}
                placeholder="Document why the severity is changing."
                className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
              />
            </div>

            <Feedback state={severityMutation.state} />
            <SubmitButton
              label="Update severity"
              pendingLabel="Updating severity..."
            />
          </form>
        </WriteGuard>
      </Section>

      <Section
        title="Commander"
        subtitle="Reassign incident command ownership."
      >
        <WriteGuard source={source}>
          <form action={commanderMutation.formAction} className="space-y-4">
            <input type="hidden" name="incidentId" value={incident.id} />
            <input type="hidden" name="redirectPath" value={redirectPath} />

            <div className="space-y-2">
              <Label label="Commander" hint="Visible users plus manual fallback" />
              <select
                name="userId"
                value={commanderUserId}
                onChange={(event) => setCommanderUserId(event.target.value)}
                className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
              >
                <option value="">Choose commander</option>
                {availableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
                <option value="__manual__">Manual user ID</option>
              </select>
              {commanderUserId === "__manual__" ? (
                <input
                  name="userManualId"
                  placeholder="Paste commander UUID"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                />
              ) : null}
            </div>

            <Feedback state={commanderMutation.state} />
            <SubmitButton
              label="Assign commander"
              pendingLabel="Assigning commander..."
            />
          </form>
        </WriteGuard>
      </Section>

      <Section
        title="Submit sitrep"
        subtitle="Post a situation report directly from the incident workspace."
      >
        <WriteGuard source={source}>
          <form action={sitrepMutation.formAction} className="space-y-4">
            <input type="hidden" name="incidentId" value={incident.id} />
            <input type="hidden" name="redirectPath" value={redirectPath} />

            <div className="space-y-2">
              <Label label="Report text" />
              <textarea
                name="text"
                required
                rows={5}
                placeholder="Water level continues to rise. Evacuation of sector B has started."
                className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label label="Severity" hint="Optional" />
                <select
                  name="severity"
                  defaultValue=""
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                >
                  <option value="">No severity override</option>
                  <option value="1">1 · Low</option>
                  <option value="2">2 · Elevated</option>
                  <option value="3">3 · High</option>
                  <option value="4">4 · Critical</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label label="Attachment IDs" hint="Comma-separated UUIDs" />
                <input
                  name="attachments"
                  placeholder="uuid-1, uuid-2"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label label="Latitude" hint="Optional" />
                <input
                  name="lat"
                  inputMode="decimal"
                  placeholder="38.5598"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                />
              </div>
              <div className="space-y-2">
                <Label label="Longitude" hint="Optional" />
                <input
                  name="lon"
                  inputMode="decimal"
                  placeholder="68.7870"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                />
              </div>
            </div>

            <Feedback state={sitrepMutation.state} />
            <SubmitButton
              label="Submit sitrep"
              pendingLabel="Submitting sitrep..."
            />
          </form>
        </WriteGuard>
      </Section>

      <Section
        title="Participants"
        subtitle="Add responders and remove them from the active incident roster."
      >
        <WriteGuard source={source}>
          <div className="space-y-6">
            <form action={addParticipantMutation.formAction} className="space-y-4">
              <input type="hidden" name="incidentId" value={incident.id} />
              <input type="hidden" name="redirectPath" value={redirectPath} />

              <div className="space-y-2">
                <Label label="Participant" hint="Active users not already in roster" />
                <select
                  name="userId"
                  value={participantUserId}
                  onChange={(event) => setParticipantUserId(event.target.value)}
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                >
                  <option value="">Choose participant</option>
                  {participantCandidates.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName}
                    </option>
                  ))}
                  <option value="__manual__">Manual user ID</option>
                </select>
                {participantUserId === "__manual__" ? (
                  <input
                    name="userManualId"
                    placeholder="Paste participant UUID"
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                  />
                ) : null}
              </div>

              <div className="space-y-2">
                <Label label="Role" />
                <select
                  name="role"
                  defaultValue="responder"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                >
                  <option value="responder">Responder</option>
                  <option value="deputy">Deputy</option>
                  <option value="liaison">Liaison</option>
                  <option value="observer">Observer</option>
                </select>
              </div>

              <Feedback state={addParticipantMutation.state} />
              <SubmitButton
                label="Add participant"
                pendingLabel="Adding participant..."
              />
            </form>

            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Active roster
              </div>

              {participants.length > 0 ? (
                participants.map((participant) => {
                  const locked = participant.roleInIncident === "commander";

                  return (
                    <form
                      key={`${participant.incidentId}-${participant.userId}`}
                      action={removeParticipantMutation.formAction}
                      className="flex items-center justify-between gap-4 rounded-[22px] border border-white/10 bg-black/10 px-4 py-3"
                    >
                      <input type="hidden" name="incidentId" value={incident.id} />
                      <input type="hidden" name="userId" value={participant.userId} />
                      <input type="hidden" name="redirectPath" value={redirectPath} />

                      <div>
                        <div className="text-sm font-medium text-white">
                          {participant.user?.fullName ?? participant.userId}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                          {participant.roleInIncident}
                        </div>
                      </div>

                      {locked ? (
                        <div className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs text-amber-50">
                          Reassign commander first
                        </div>
                      ) : (
                        <SubmitButton
                          label="Remove"
                          pendingLabel="Removing..."
                          className="border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/16"
                        />
                      )}
                    </form>
                  );
                })
              ) : (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
                  No active participants.
                </div>
              )}
            </div>

            <Feedback state={removeParticipantMutation.state} />
          </div>
        </WriteGuard>
      </Section>
    </aside>
  );
}

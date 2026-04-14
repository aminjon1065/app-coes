"use client";

import type { ReactNode } from "react";
import {
  useActionState,
  useEffect,
  useState,
  startTransition,
  useRef,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  addTaskCommentAction,
  assignTaskAction,
  createTaskAction,
  INITIAL_TASK_MUTATION_STATE,
  type TaskMutationState,
  transitionTaskAction,
  updateTaskAction,
} from "@/app/(app)/tasks/actions";
import {
  type AvailableTransitionDto,
  type IncidentSummary,
  type TaskDetailDto,
  type TaskWorkspace,
  type UserSummary,
} from "@/lib/api/task-workspace";
import { cn } from "@/lib/utils";

type TaskControlPanelProps = {
  source: TaskWorkspace["source"];
  selectedTask: TaskDetailDto | null;
  visibleIncidents: IncidentSummary[];
  visibleUsers: UserSummary[];
  availableTransitions: AvailableTransitionDto[];
  defaultIncidentId?: string | null;
  redirectBasePath?: string;
  selectedTaskRedirectPath?: string;
};

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function useTaskMutation(
  action: (
    previousState: TaskMutationState,
    formData: FormData,
  ) => Promise<TaskMutationState>,
) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, formAction] = useActionState(
    action,
    INITIAL_TASK_MUTATION_STATE,
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

function FormSection({
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

function MutationFeedback({ state }: { state: TaskMutationState }) {
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
  requiresReason,
}: {
  code: string;
  label: string;
  requiresReason: boolean;
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
        requiresReason
          ? "border-amber-300/30 bg-amber-300/10 text-amber-50 hover:bg-amber-300/14"
          : "border-sky-300/30 bg-sky-300/10 text-sky-50 hover:bg-sky-300/14",
      )}
    >
      <span className="text-sm font-medium">{pending ? "Submitting..." : label}</span>
      <span className="text-[11px] uppercase tracking-[0.24em] text-white/55">
        {requiresReason ? "Reason required" : "Direct"}
      </span>
    </button>
  );
}

function FieldLabel({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <label className="block space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          {label}
        </span>
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </div>
    </label>
  );
}

function WriteGuard({
  source,
  children,
}: {
  source: TaskWorkspace["source"];
  children: ReactNode;
}) {
  if (source === "api") {
    return <>{children}</>;
  }

  return (
    <div className="rounded-[24px] border border-amber-300/25 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
      Write actions are disabled because the page is currently running on the
      mock fallback workspace. Point the frontend to a live backend and valid
      auth context to enable mutations.
    </div>
  );
}

export function TaskControlPanel({
  source,
  selectedTask,
  visibleIncidents,
  visibleUsers,
  availableTransitions,
  defaultIncidentId,
  redirectBasePath = "/tasks",
  selectedTaskRedirectPath,
}: TaskControlPanelProps) {
  const immutable =
    selectedTask?.status === "done" || selectedTask?.status === "cancelled";
  const [createAssigneeId, setCreateAssigneeId] = useState("");
  const [assignAssigneeId, setAssignAssigneeId] = useState(
    selectedTask?.assigneeId ?? "",
  );

  const createMutation = useTaskMutation(createTaskAction);
  const updateMutation = useTaskMutation(updateTaskAction);
  const assignMutation = useTaskMutation(assignTaskAction);
  const transitionMutation = useTaskMutation(transitionTaskAction);
  const commentMutation = useTaskMutation(addTaskCommentAction);

  return (
    <aside className="space-y-6">
      <section className="rounded-[32px] border border-white/10 bg-[rgba(12,16,26,0.88)] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.2)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-200/70">
          Task command rail
        </p>
        <h2 className="mt-3 text-2xl font-medium text-white">
          Create, adjust, assign, transition, and comment without leaving the
          board.
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          Mutations are wired to the new task slice. Task-specific actions use
          the currently selected task from the board.
        </p>
      </section>

      <FormSection
        title="Create task"
        subtitle="Open a new incident-linked or standalone task directly from the board view."
        defaultOpen
      >
        <WriteGuard source={source}>
          <form action={createMutation.formAction} className="space-y-4">
            <input
              type="hidden"
              name="redirectBasePath"
              value={redirectBasePath}
            />
            <FieldLabel label="Title" />
            <input
              name="title"
              required
              placeholder="Establish logistics coordination cell"
              className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-cyan-300/35"
            />

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel label="Incident" hint="Optional" />
                <select
                  name="incidentId"
                  defaultValue={selectedTask?.incidentId ?? defaultIncidentId ?? ""}
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                >
                  <option value="">Standalone task</option>
                  {visibleIncidents.map((incident) => (
                    <option key={incident.id} value={incident.id}>
                      {incident.code} · {incident.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <FieldLabel label="Priority" />
                <select
                  name="priority"
                  defaultValue="3"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                >
                  <option value="1">1 · Critical</option>
                  <option value="2">2 · High</option>
                  <option value="3">3 · Medium</option>
                  <option value="4">4 · Low</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <FieldLabel
                label="Assignee"
                hint="Optional, uses visible workspace users"
              />
              <select
                name="assigneeId"
                value={createAssigneeId}
                onChange={(event) => setCreateAssigneeId(event.target.value)}
                className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
              >
                <option value="">Leave unassigned</option>
                {visibleUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
                <option value="__manual__">Manual user ID</option>
              </select>
              {createAssigneeId === "__manual__" ? (
                <input
                  name="assigneeManualId"
                  placeholder="Paste assignee UUID"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                />
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel label="Due at" hint="Optional" />
                <input
                  name="dueAt"
                  type="datetime-local"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                />
              </div>
              <div className="space-y-2">
                <FieldLabel label="SLA breach at" hint="Optional" />
                <input
                  name="slaBreachAt"
                  type="datetime-local"
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                />
              </div>
            </div>

            <div className="space-y-2">
              <FieldLabel label="Description" hint="Optional" />
              <textarea
                name="description"
                rows={4}
                placeholder="Summarize intent, constraints, and expected completion signal."
                className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
              />
            </div>

            <MutationFeedback state={createMutation.state} />
            <SubmitButton label="Create task" pendingLabel="Creating task..." />
          </form>
        </WriteGuard>
      </FormSection>

      <FormSection
        title="Update selected"
        subtitle={
          selectedTask
            ? "Patch the mutable fields of the task currently in focus."
            : "Pick a task from the board to edit title, description, priority, and due windows."
        }
      >
        {selectedTask ? (
          <WriteGuard source={source}>
            <form
              key={selectedTask.id}
              action={updateMutation.formAction}
              className="space-y-4"
            >
              <input type="hidden" name="taskId" value={selectedTask.id} />
              <input
                type="hidden"
                name="redirectPath"
                value={selectedTaskRedirectPath ?? redirectBasePath}
              />

              {immutable ? (
                <div className="rounded-[22px] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                  Terminal tasks are immutable on the backend. Use comments for
                  additional context, but edits and reassignment are blocked.
                </div>
              ) : null}

              <fieldset disabled={immutable} className="space-y-4 disabled:opacity-60">
                <div className="space-y-2">
                  <FieldLabel label="Title" />
                  <input
                    name="title"
                    required
                    defaultValue={selectedTask.title}
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel label="Priority" />
                    <select
                      name="priority"
                      defaultValue={String(selectedTask.priority)}
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      <option value="1">1 · Critical</option>
                      <option value="2">2 · High</option>
                      <option value="3">3 · Medium</option>
                      <option value="4">4 · Low</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <FieldLabel label="Due at" hint="Blank clears value" />
                    <input
                      name="dueAt"
                      type="datetime-local"
                      defaultValue={toDateTimeLocalValue(selectedTask.dueAt)}
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <FieldLabel label="SLA breach at" hint="Blank clears value" />
                  <input
                    name="slaBreachAt"
                    type="datetime-local"
                    defaultValue={toDateTimeLocalValue(selectedTask.slaBreachAt)}
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                  />
                </div>

                <div className="space-y-2">
                  <FieldLabel label="Description" hint="Blank clears value" />
                  <textarea
                    name="description"
                    rows={5}
                    defaultValue={selectedTask.description ?? ""}
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/35"
                  />
                </div>

                <MutationFeedback state={updateMutation.state} />
                <SubmitButton
                  label="Save task changes"
                  pendingLabel="Saving changes..."
                />
              </fieldset>
            </form>
          </WriteGuard>
        ) : (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
            No task selected.
          </div>
        )}
      </FormSection>

      <FormSection
        title="Assign / reassign"
        subtitle={
          selectedTask
            ? "Change ownership and capture assignment rationale."
            : "Select a task before changing assignee."
        }
      >
        {selectedTask ? (
          <WriteGuard source={source}>
            <form
              key={`assign-${selectedTask.id}`}
              action={assignMutation.formAction}
              className="space-y-4"
            >
              <input type="hidden" name="taskId" value={selectedTask.id} />
              <input
                type="hidden"
                name="redirectPath"
                value={selectedTaskRedirectPath ?? redirectBasePath}
              />

              {immutable ? (
                <div className="rounded-[22px] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                  Reassignment is blocked after the task reaches a terminal
                  state.
                </div>
              ) : null}

              <fieldset disabled={immutable} className="space-y-4 disabled:opacity-60">
                <div className="space-y-2">
                  <FieldLabel
                    label="Assignee"
                    hint="Visible users plus manual fallback"
                  />
                  <select
                    name="assigneeId"
                    value={assignAssigneeId}
                    onChange={(event) => setAssignAssigneeId(event.target.value)}
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                  >
                    <option value="">Choose assignee</option>
                    {visibleUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                      </option>
                    ))}
                    <option value="__manual__">Manual user ID</option>
                  </select>
                  {assignAssigneeId === "__manual__" ? (
                    <input
                      name="assigneeManualId"
                      placeholder="Paste assignee UUID"
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                    />
                  ) : null}
                </div>

                <div className="space-y-2">
                  <FieldLabel label="Reason" hint="Optional audit trail" />
                  <textarea
                    name="reason"
                    rows={3}
                    placeholder="Why this operator should own the task now."
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                  />
                </div>

                <MutationFeedback state={assignMutation.state} />
                <SubmitButton
                  label="Update assignee"
                  pendingLabel="Updating assignee..."
                />
              </fieldset>
            </form>
          </WriteGuard>
        ) : (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
            No task selected.
          </div>
        )}
      </FormSection>

      <FormSection
        title="Status transitions"
        subtitle={
          selectedTask
            ? "Available transitions come directly from the backend transition policy."
            : "Pick a task to see the transitions available to the current actor."
        }
      >
        {selectedTask ? (
          <WriteGuard source={source}>
            <form
              key={`transition-${selectedTask.id}`}
              action={transitionMutation.formAction}
              className="space-y-4"
            >
              <input type="hidden" name="taskId" value={selectedTask.id} />
              <input
                type="hidden"
                name="redirectPath"
                value={selectedTaskRedirectPath ?? redirectBasePath}
              />

              {availableTransitions.length > 0 ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    {availableTransitions.map((transition) => (
                      <TransitionButton
                        key={transition.code}
                        code={transition.code}
                        label={transition.label}
                        requiresReason={transition.requires.includes("reason")}
                      />
                    ))}
                  </div>

                  <div className="space-y-2">
                    <FieldLabel
                      label="Reason"
                      hint="Required only for transitions marked as such"
                    />
                    <textarea
                      name="reason"
                      rows={3}
                      placeholder="Explain blockers, rejection rationale, or other transition context."
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
                  No transitions are currently available for this task.
                </div>
              )}

              <MutationFeedback state={transitionMutation.state} />
            </form>
          </WriteGuard>
        ) : (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
            No task selected.
          </div>
        )}
      </FormSection>

      <FormSection
        title="Add comment"
        subtitle={
          selectedTask
            ? "Append operational context without leaving the detail view."
            : "Pick a task to add a comment."
        }
      >
        {selectedTask ? (
          <WriteGuard source={source}>
            <form
              key={`comment-${selectedTask.id}`}
              action={commentMutation.formAction}
              className="space-y-4"
            >
              <input type="hidden" name="taskId" value={selectedTask.id} />
              <input
                type="hidden"
                name="redirectPath"
                value={selectedTaskRedirectPath ?? redirectBasePath}
              />

              <div className="space-y-2">
                <FieldLabel label="Comment body" />
                <textarea
                  name="body"
                  required
                  rows={4}
                  placeholder="Record update, blocker, hand-off note, or field observation."
                  className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                />
              </div>

              <MutationFeedback state={commentMutation.state} />
              <SubmitButton
                label="Post comment"
                pendingLabel="Posting comment..."
              />
            </form>
          </WriteGuard>
        ) : (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
            No task selected.
          </div>
        )}
      </FormSection>
    </aside>
  );
}

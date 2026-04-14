"use client";

import type { ReactNode } from "react";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  startTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  bulkCreateIncidentsAction,
  createIncidentAction,
  INITIAL_INCIDENT_INDEX_MUTATION_STATE,
  type IncidentIndexMutationState,
} from "@/app/(app)/incidents/actions";
import {
  INCIDENT_CATEGORY_OPTIONS,
  type IncidentDto,
} from "@/lib/api/incident-workspace";
import { type UserSummary } from "@/lib/api/task-workspace";
import { cn } from "@/lib/utils";

type IncidentIndexPanelProps = {
  source: "api" | "mock";
  availableUsers: UserSummary[];
  incidents: IncidentDto[];
};

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
  name,
  value,
}: {
  label: string;
  pendingLabel: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
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
      Incident creation is disabled because the page is currently using the mock
      fallback workspace.
    </div>
  );
}

export function IncidentIndexPanel({
  source,
  availableUsers,
  incidents,
}: IncidentIndexPanelProps) {
  const createMutation = useIncidentIndexMutation(createIncidentAction);
  const bulkCreateMutation = useIncidentIndexMutation(bulkCreateIncidentsAction);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [commanderId, setCommanderId] = useState("");
  const [parentId, setParentId] = useState("");
  const [batchCommanderId, setBatchCommanderId] = useState("");
  const [mode, setMode] = useState<"single" | "batch">("single");
  const redirectPath = searchParams?.toString()
    ? `${pathname}?${searchParams.toString()}`
    : pathname;

  return (
    <section className="rounded-[32px] border border-white/10 bg-[rgba(12,16,26,0.88)] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.2)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-200/70">
        Incident intake
      </p>
      <h2 className="mt-3 text-2xl font-medium text-white">
        Create a new incident and route command ownership from the index page.
      </h2>
      <p className="mt-3 text-sm leading-7 text-slate-300">
        This form opens the incident as a draft and immediately redirects into
        the incident detail workspace.
      </p>

      <div className="mt-6">
        <WriteGuard source={source}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("single")}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition",
                  mode === "single"
                    ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
                )}
              >
                Single intake
              </button>
              <button
                type="button"
                onClick={() => setMode("batch")}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition",
                  mode === "batch"
                    ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
                )}
              >
                Batch intake
              </button>
            </div>

            {mode === "single" ? (
              <form action={createMutation.formAction} className="space-y-4">
                <input type="hidden" name="redirectPath" value={redirectPath} />

                <div className="space-y-2">
                  <Label label="Title" />
                  <input
                    name="title"
                    required
                    placeholder="Earthquake near Dushanbe city perimeter"
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                  />
                </div>

                <div className="space-y-2">
                  <Label label="Description" hint="Optional" />
                  <textarea
                    name="description"
                    rows={4}
                    placeholder="Initial field reports indicate structural damage in two districts."
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label label="Category" />
                    <select
                      name="category"
                      defaultValue="flood"
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      {INCIDENT_CATEGORY_OPTIONS.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label label="Severity" />
                    <select
                      name="severity"
                      defaultValue="2"
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      <option value="1">1 · Low</option>
                      <option value="2">2 · Elevated</option>
                      <option value="3">3 · High</option>
                      <option value="4">4 · Critical</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label label="Classification" hint="Optional" />
                    <select
                      name="classification"
                      defaultValue="1"
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      <option value="1">1 · Public</option>
                      <option value="2">2 · Internal</option>
                      <option value="3">3 · Confidential</option>
                      <option value="4">4 · Secret</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label label="Commander" hint="Optional" />
                    <select
                      name="commanderId"
                      value={commanderId}
                      onChange={(event) => setCommanderId(event.target.value)}
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      <option value="">No commander yet</option>
                      {availableUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.fullName}
                        </option>
                      ))}
                      <option value="__manual__">Manual user ID</option>
                    </select>
                    {commanderId === "__manual__" ? (
                      <input
                        name="commanderManualId"
                        placeholder="Paste commander UUID"
                        className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label label="Parent incident" hint="Optional" />
                  <select
                    name="parentId"
                    value={parentId}
                    onChange={(event) => setParentId(event.target.value)}
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                  >
                    <option value="">No parent incident</option>
                    {incidents.map((incident) => (
                      <option key={incident.id} value={incident.id}>
                        {incident.code} · {incident.title}
                      </option>
                    ))}
                    <option value="__manual__">Manual incident ID</option>
                  </select>
                  {parentId === "__manual__" ? (
                    <input
                      name="parentManualId"
                      placeholder="Paste parent incident UUID"
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                    />
                  ) : null}
                </div>

                <Feedback state={createMutation.state} />
                <div className="flex flex-wrap gap-3">
                  <SubmitButton
                    label="Create and open"
                    pendingLabel="Creating incident..."
                    name="submitMode"
                    value="open"
                  />
                  <SubmitButton
                    label="Create and stay"
                    pendingLabel="Creating incident..."
                    name="submitMode"
                    value="stay"
                  />
                </div>
              </form>
            ) : (
              <form action={bulkCreateMutation.formAction} className="space-y-4">
                <input type="hidden" name="redirectPath" value={redirectPath} />

                <div className="space-y-2">
                  <Label label="Batch lines" hint="One incident per line" />
                  <textarea
                    name="batchLines"
                    rows={8}
                    placeholder={[
                      "Bridge collapse near district market | industrial | 3 | Initial rescue dispatch requested",
                      "Flash flood at eastern canal | flood | 2 | Water level rising near school perimeter",
                      "Shelter registration overflow",
                    ].join("\n")}
                    className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 font-mono text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                  />
                  <p className="text-xs leading-6 text-slate-500">
                    Format: <code>title | category | severity | optional description</code>.
                    If category or severity is omitted, defaults below are used.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label label="Default category" />
                    <select
                      name="batchDefaultCategory"
                      defaultValue="flood"
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      {INCIDENT_CATEGORY_OPTIONS.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label label="Default severity" />
                    <select
                      name="batchDefaultSeverity"
                      defaultValue="2"
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      <option value="1">1 · Low</option>
                      <option value="2">2 · Elevated</option>
                      <option value="3">3 · High</option>
                      <option value="4">4 · Critical</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label label="Classification" hint="Shared default" />
                    <select
                      name="batchClassification"
                      defaultValue="1"
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      <option value="1">1 · Public</option>
                      <option value="2">2 · Internal</option>
                      <option value="3">3 · Confidential</option>
                      <option value="4">4 · Secret</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label label="Commander" hint="Optional shared owner" />
                    <select
                      name="batchCommanderId"
                      value={batchCommanderId}
                      onChange={(event) => setBatchCommanderId(event.target.value)}
                      className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
                    >
                      <option value="">No commander yet</option>
                      {availableUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.fullName}
                        </option>
                      ))}
                      <option value="__manual__">Manual user ID</option>
                    </select>
                    {batchCommanderId === "__manual__" ? (
                      <input
                        name="batchCommanderManualId"
                        placeholder="Paste commander UUID"
                        className="w-full rounded-[20px] border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                      />
                    ) : null}
                  </div>
                </div>

                <Feedback state={bulkCreateMutation.state} />
                <SubmitButton
                  label="Create batch"
                  pendingLabel="Creating incidents..."
                />
              </form>
            )}
          </div>
        </WriteGuard>
      </div>
    </section>
  );
}

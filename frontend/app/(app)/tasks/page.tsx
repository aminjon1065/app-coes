import { TaskWorkspaceLiveShell } from "@/components/task/task-workspace-live-shell";
import { loadTaskWorkspace } from "@/lib/api/task-workspace";

type TaskPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TasksPage({ searchParams }: TaskPageProps) {
  const resolvedSearchParams = await searchParams;
  const taskId = firstParam(resolvedSearchParams.taskId);
  const workspace = await loadTaskWorkspace({ taskId });
  const initialFetchedAt = new Date().toISOString();

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-4xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
              Task operations
            </p>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              Full board, operator queue, overdue list, and detail inspection.
            </h1>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              This page is wired to the new task slice contract. If the API is unavailable or unauthenticated, the UI falls back to a seeded demo workspace instead of rendering blank.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Current feed
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {workspace.source === "api" ? "Backend task endpoints" : "Local mock workspace"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Refreshed {workspace.refreshedAt}
            </div>
          </div>
        </div>
      </section>

      <TaskWorkspaceLiveShell
        initialWorkspace={workspace}
        initialFetchedAt={initialFetchedAt}
        taskId={taskId ?? undefined}
      />
    </main>
  );
}

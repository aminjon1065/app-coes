import Link from "next/link";
import { ArrowRight, RadioTower, TriangleAlert } from "lucide-react";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { TaskKpiStrip } from "@/components/task/task-kpi-strip";
import { TaskRailList } from "@/components/task/task-rail-list";
import { TaskStatusBoard } from "@/components/task/task-status-board";
import {
  getTaskBoardSignature,
  loadTaskWorkspace,
} from "@/lib/api/task-workspace";

export default async function DashboardPage() {
  const workspace = await loadTaskWorkspace();

  return (
    <main className="space-y-6 pb-8">
      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                Command snapshot
              </p>
              <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
                Task command deck for the current operational shift.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                Monitor lane pressure, overdue work, and the currently selected task without leaving the dashboard.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Data source
              </div>
              <div className="mt-2 text-sm font-medium text-white">
                {workspace.source === "api" ? "Live backend" : "Fallback demo snapshot"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Refreshed {workspace.refreshedAt}
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/tasks"
              className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
            >
              Open full task board <ArrowRight className="h-4 w-4" />
            </Link>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-300">
              <RadioTower className="h-4 w-4 text-emerald-300" />
              Queue synchronized for dashboard view
            </div>
          </div>
        </div>

        <div className="rounded-[34px] border border-white/10 bg-white/5 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.18)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-slate-500">
            Incident focus
          </p>
          <h2 className="mt-3 text-2xl font-medium text-white">
            {workspace.highlightedIncident?.code ?? "No incident selected"}
          </h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            {workspace.highlightedIncident?.title ??
              "Task data is available, but the current selection is not tied to a visible incident."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-slate-200">
              Status: {workspace.highlightedIncident?.status ?? "n/a"}
            </span>
            <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-100">
              Severity {workspace.highlightedIncident?.severity ?? "n/a"}
            </span>
          </div>
          {workspace.overdueTasks.length > 0 ? (
            <div className="mt-8 rounded-[24px] border border-rose-400/20 bg-rose-400/8 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-rose-100">
                <TriangleAlert className="h-4 w-4" />
                {workspace.overdueTasks.length} overdue tasks need intervention
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <TaskKpiStrip
        board={workspace.board}
        myTasks={workspace.myTasks}
        overdueTasks={workspace.overdueTasks}
        selectedTask={workspace.selectedTask}
      />

      <section className="grid gap-6 xl:grid-cols-[1.55fr_0.95fr]">
        <TaskStatusBoard
          key={getTaskBoardSignature(workspace.board)}
          board={workspace.board}
          selectedTaskId={workspace.selectedTask?.id}
          maxPerColumn={3}
        />
        <div className="space-y-6">
          <TaskRailList
            title="My queue"
            subtitle="Tasks currently assigned to the active operator"
            tasks={workspace.myTasks}
            selectedTaskId={workspace.selectedTask?.id}
            emptyLabel="No active tasks assigned."
          />
          <TaskRailList
            title="Overdue"
            subtitle="Items already outside their due window"
            tasks={workspace.overdueTasks}
            selectedTaskId={workspace.selectedTask?.id}
            emptyLabel="No overdue tasks in view."
            tone="danger"
          />
        </div>
      </section>

      <TaskDetailPanel task={workspace.selectedTask} compact />
    </main>
  );
}

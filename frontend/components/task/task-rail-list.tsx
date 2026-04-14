import Link from "next/link";
import {
  formatTaskRelative,
  getDueState,
  getTaskHref,
  TASK_PRIORITY_META,
  type TaskDto,
} from "@/lib/api/task-workspace";
import { cn } from "@/lib/utils";

type TaskRailListProps = {
  title: string;
  subtitle: string;
  tasks: TaskDto[];
  selectedTaskId?: string | null;
  emptyLabel: string;
  tone?: "neutral" | "danger";
  taskHrefBuilder?: (taskId: string) => string;
};

export function TaskRailList({
  title,
  subtitle,
  tasks,
  selectedTaskId,
  emptyLabel,
  tone = "neutral",
  taskHrefBuilder = getTaskHref,
}: TaskRailListProps) {
  return (
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            {title}
          </p>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
        <div
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            tone === "danger"
              ? "border-rose-400/35 bg-rose-400/10 text-rose-100"
              : "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
          )}
        >
          {tasks.length}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {tasks.length > 0 ? (
          tasks.map((task) => {
            const due = getDueState(task);
            const priority = TASK_PRIORITY_META[task.priority];
            const selected = selectedTaskId === task.id;

            return (
              <Link
                key={task.id}
                href={taskHrefBuilder(task.id)}
                className={cn(
                  "block rounded-[24px] border p-4 transition",
                  selected
                    ? "border-cyan-300/35 bg-cyan-300/10"
                    : "border-white/10 bg-black/10 hover:border-white/20 hover:bg-white/6",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
                      {task.incident?.code ?? "Standalone"}
                    </div>
                    <h3 className="mt-2 text-sm font-medium leading-6 text-white">
                      {task.title}
                    </h3>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      priority.chip,
                    )}
                  >
                    {priority.label}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-medium",
                      due.tone,
                    )}
                  >
                    {due.label}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    Updated {formatTaskRelative(task.updatedAt)}
                  </span>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

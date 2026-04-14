import {
  formatTaskRelative,
  formatTaskTimestamp,
  getTaskCompletionRatio,
  getDueState,
  TASK_PRIORITY_META,
  type TaskDetailDto,
} from "@/lib/api/task-workspace";
import { cn } from "@/lib/utils";

type TaskDetailPanelProps = {
  task: TaskDetailDto | null;
  compact?: boolean;
};

export function TaskDetailPanel({
  task,
  compact = false,
}: TaskDetailPanelProps) {
  if (!task) {
    return (
      <aside className="rounded-[32px] border border-white/10 bg-white/5 p-6 text-slate-400 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
        No task is selected. Pick any card from the board to inspect comments,
        assignment history, and subtask progress.
      </aside>
    );
  }

  const priority = TASK_PRIORITY_META[task.priority];
  const due = getDueState(task);
  const completionRatio = getTaskCompletionRatio(task);
  const comments = compact ? task.latestComments.slice(0, 2) : task.latestComments;
  const assignments = compact
    ? task.assignmentHistory.slice(0, 3)
    : task.assignmentHistory;

  return (
    <aside className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            Task detail
          </p>
          <h2 className="mt-2 text-2xl font-medium leading-tight text-white">
            {task.title}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {task.incident?.code ?? "Standalone task"}{" "}
            {task.incident ? `· ${task.incident.title}` : "· Planning / standalone queue"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              priority.chip,
            )}
          >
            {priority.label}
          </span>
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium capitalize",
              due.tone,
            )}
          >
            {task.status.replaceAll("_", " ")}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[24px] border border-white/10 bg-black/10 p-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Assignee
          </div>
          <div className="mt-2 text-sm text-white">
            {task.assignee?.fullName ?? "Unassigned"}
          </div>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-black/10 p-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Due window
          </div>
          <div className="mt-2 text-sm text-white">{due.label}</div>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-black/10 p-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            SLA breach
          </div>
          <div className="mt-2 text-sm text-white">
            {formatTaskTimestamp(task.slaBreachAt)}
          </div>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-black/10 p-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Last change
          </div>
          <div className="mt-2 text-sm text-white">
            {formatTaskRelative(task.updatedAt)}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[24px] border border-white/10 bg-black/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Subtask completion
            </div>
            <div className="mt-2 text-sm text-white">
              {task.stats.completedSubtaskCount} of {task.stats.subtaskCount} completed
            </div>
          </div>
          <div className="text-2xl font-semibold text-white">{completionRatio}%</div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#60a5fa,#22d3ee)]"
            style={{ width: `${completionRatio}%` }}
          />
        </div>
      </div>

      <div className="mt-6 rounded-[24px] border border-white/10 bg-black/10 p-4">
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
          Description
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          {task.description ?? "No description available yet for this task."}
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <section className="rounded-[24px] border border-white/10 bg-black/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Latest comments
            </div>
            <div className="text-xs text-slate-500">{task.stats.commentCount} total</div>
          </div>

          <div className="mt-4 space-y-3">
            {comments.length > 0 ? (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-[20px] border border-white/10 bg-white/5 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-white">
                      {comment.author?.fullName ?? "Unknown author"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatTaskRelative(comment.createdAt)}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{comment.body}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                No comments yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-black/10 p-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Assignment history
          </div>
          <div className="mt-4 space-y-3">
            {assignments.length > 0 ? (
              assignments.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-4 rounded-[20px] border border-white/10 bg-white/5 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">
                      {entry.assignee?.fullName ?? "Unassigned"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      by {entry.assignedByUser?.fullName ?? entry.assignedBy}
                    </div>
                    {entry.reason ? (
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        {entry.reason}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-xs text-slate-500">
                    {formatTaskTimestamp(entry.assignedAt)}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                No assignment history yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

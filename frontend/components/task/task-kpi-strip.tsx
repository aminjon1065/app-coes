import {
  countBoardTasks,
  type TaskBoardDto,
  type TaskDetailDto,
  type TaskDto,
} from "@/lib/api/task-workspace";

type TaskKpiStripProps = {
  board: TaskBoardDto;
  myTasks: TaskDto[];
  overdueTasks: TaskDto[];
  selectedTask: TaskDetailDto | null;
};

function countUnassigned(board: TaskBoardDto) {
  return [board.todo, board.inProgress, board.blocked, board.review]
    .flat()
    .filter((task) => !task.assigneeId).length;
}

export function TaskKpiStrip({
  board,
  myTasks,
  overdueTasks,
  selectedTask,
}: TaskKpiStripProps) {
  const stats = [
    {
      label: "Visible tasks",
      value: countBoardTasks(board),
      panel:
        "bg-[linear-gradient(135deg,rgba(34,211,238,0.18),rgba(34,211,238,0.02))]",
      accent: "text-cyan-100",
    },
    {
      label: "My active queue",
      value: myTasks.length,
      panel:
        "bg-[linear-gradient(135deg,rgba(167,139,250,0.18),rgba(167,139,250,0.02))]",
      accent: "text-violet-100",
    },
    {
      label: "Overdue",
      value: overdueTasks.length,
      panel:
        "bg-[linear-gradient(135deg,rgba(251,113,133,0.22),rgba(251,113,133,0.02))]",
      accent: "text-rose-100",
    },
    {
      label: "Unassigned",
      value: countUnassigned(board),
      panel:
        "bg-[linear-gradient(135deg,rgba(252,211,77,0.18),rgba(252,211,77,0.02))]",
      accent: "text-amber-50",
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`rounded-[28px] border border-white/10 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.18)] ${stat.panel}`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            {stat.label}
          </p>
          <div className={`mt-4 text-4xl font-semibold ${stat.accent}`}>{stat.value}</div>
        </div>
      ))}

      {selectedTask ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 md:col-span-2 xl:col-span-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Current task focus
          </p>
          <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="max-w-4xl text-xl font-medium text-white">
                {selectedTask.title}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                {selectedTask.description ?? "No description yet. The UI is ready for the backend detail payload."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-slate-300 md:grid-cols-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Status
                </div>
                <div className="mt-1 capitalize">{selectedTask.status.replaceAll("_", " ")}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Priority
                </div>
                <div className="mt-1">{selectedTask.priority}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Subtasks
                </div>
                <div className="mt-1">
                  {selectedTask.stats.completedSubtaskCount}/{selectedTask.stats.subtaskCount}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Comments
                </div>
                <div className="mt-1">{selectedTask.stats.commentCount}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

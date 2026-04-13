import { tasks } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

const priorityColors: Record<number, string> = {
  1: "bg-severity-1",
  2: "bg-severity-2",
  3: "bg-severity-3",
  4: "bg-severity-4",
};

const incidentCodeColors: Record<string, string> = {
  "EQ-2026-04-1234": "text-severity-4 bg-severity-bg-4 border-severity-4/30",
  "FL-2026-04-0980": "text-severity-3 bg-severity-bg-3 border-severity-3/30",
  "FR-2026-04-0871": "text-severity-3 bg-severity-bg-3 border-severity-3/30",
  "IN-2026-04-0820": "text-severity-2 bg-severity-bg-2 border-severity-2/30",
  "MG-2026-04-0790": "text-severity-1 bg-severity-bg-1 border-severity-1/30",
  "OB-2026-04-0644": "text-severity-1 bg-severity-bg-1 border-severity-1/30",
};

export function TasksToday() {
  return (
    <div className="flex flex-col bg-coescd-card border border-coescd-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-coescd-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-coescd-text">Tasks — Due Today</h2>
          <span className="text-2xs font-bold px-1.5 py-0.5 rounded-sm bg-coescd-border text-coescd-muted">
            {tasks.length}
          </span>
        </div>
        <a
          href="/tasks"
          className="flex items-center gap-1 text-xs text-coescd-primary hover:text-coescd-text transition-colors"
        >
          View all <ArrowRight className="w-3 h-3" />
        </a>
      </div>

      {/* Task list */}
      <div className="flex-1 divide-y divide-coescd-border overflow-y-auto">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2 h-9",
              "hover:bg-coescd-border/40 transition-colors group",
              task.overdue && "bg-severity-bg-4"
            )}
          >
            {/* Checkbox */}
            <div
              className={cn(
                "w-3.5 h-3.5 rounded-sm border shrink-0 flex items-center justify-center",
                task.overdue ? "border-severity-4/60" : "border-coescd-border"
              )}
            />

            {/* Task name */}
            <p className="flex-1 text-xs text-coescd-text truncate group-hover:text-coescd-text">
              {task.name}
            </p>

            {/* Incident code */}
            <span
              className={cn(
                "font-mono text-2xs px-1.5 py-0.5 rounded-sm border shrink-0",
                incidentCodeColors[task.incidentCode] || "text-coescd-muted bg-coescd-border border-coescd-border"
              )}
            >
              {task.incidentCode.split("-")[0]}
            </span>

            {/* Priority dot */}
            <div
              className={cn("w-1.5 h-1.5 rounded-full shrink-0", priorityColors[task.priority])}
            />

            {/* Due time */}
            <span
              className={cn(
                "font-mono text-xs shrink-0 min-w-[52px] text-right",
                task.overdue && "text-severity-4 font-semibold",
                !task.overdue && task.nearDue && "text-severity-2",
                !task.overdue && !task.nearDue && "text-coescd-muted"
              )}
            >
              {task.dueTime}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

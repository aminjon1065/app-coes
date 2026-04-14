"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { reorderTaskBoardAction } from "@/app/(app)/tasks/actions";
import {
  BOARD_KEY_TO_TASK_STATUS,
  getDueState,
  getTaskHref,
  getTaskBoardSignature,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
  type TaskBoardColumnKey,
  type TaskBoardDto,
  type TaskDto,
} from "@/lib/api/task-workspace";
import { cn } from "@/lib/utils";

type TaskStatusBoardProps = {
  board: TaskBoardDto;
  selectedTaskId?: string | null;
  maxPerColumn?: number;
  interactive?: boolean;
  taskHrefBuilder?: (taskId: string) => string;
};

type TaskLocation = {
  columnKey: TaskBoardColumnKey;
  index: number;
  task: TaskDto;
};

function cloneBoard(board: TaskBoardDto): TaskBoardDto {
  return {
    todo: [...board.todo],
    inProgress: [...board.inProgress],
    blocked: [...board.blocked],
    review: [...board.review],
    done: [...board.done],
    cancelled: [...board.cancelled],
  };
}

function normalizePositions(board: TaskBoardDto, keys: TaskBoardColumnKey[]) {
  for (const key of keys) {
    board[key] = board[key].map((task, index) => ({
      ...task,
      status: BOARD_KEY_TO_TASK_STATUS[key],
      position: index,
    }));
  }

  return board;
}

function findTaskLocation(board: TaskBoardDto, taskId: string): TaskLocation | null {
  for (const columnKey of TASK_STATUS_ORDER) {
    const index = board[columnKey].findIndex((task) => task.id === taskId);

    if (index !== -1) {
      return {
        columnKey,
        index,
        task: board[columnKey][index],
      };
    }
  }

  return null;
}

function resolveDropTarget(board: TaskBoardDto, overId: string) {
  if (overId.startsWith("column:")) {
    const columnKey = overId.replace("column:", "") as TaskBoardColumnKey;

    if (TASK_STATUS_ORDER.includes(columnKey)) {
      return {
        columnKey,
        index: board[columnKey].length,
      };
    }

    return null;
  }

  const location = findTaskLocation(board, overId);

  if (!location) {
    return null;
  }

  return {
    columnKey: location.columnKey,
    index: location.index,
  };
}

function moveTask(
  board: TaskBoardDto,
  source: TaskLocation,
  target: { columnKey: TaskBoardColumnKey; index: number },
) {
  const nextBoard = cloneBoard(board);
  const sourceTasks = nextBoard[source.columnKey];
  const [movedTask] = sourceTasks.splice(source.index, 1);

  if (!movedTask) {
    return board;
  }

  const targetTasks = nextBoard[target.columnKey];
  const insertionIndex =
    source.columnKey === target.columnKey
      ? Math.max(0, Math.min(target.index, targetTasks.length))
      : Math.max(0, Math.min(target.index, targetTasks.length));

  targetTasks.splice(insertionIndex, 0, {
    ...movedTask,
    status: BOARD_KEY_TO_TASK_STATUS[target.columnKey],
  });

  return normalizePositions(nextBoard, [source.columnKey, target.columnKey]);
}

function TaskCardBody({
  task,
  selectedTaskId,
  dragHandle,
  taskHrefBuilder,
}: {
  task: TaskDto;
  selectedTaskId?: string | null;
  dragHandle?: ReactNode;
  taskHrefBuilder: (taskId: string) => string;
}) {
  const due = getDueState(task);
  const priority = TASK_PRIORITY_META[task.priority];
  const selected = selectedTaskId === task.id;

  return (
    <div
      className={cn(
        "group rounded-[24px] border p-4 transition",
        selected
          ? "border-cyan-300/35 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.1)_inset]"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <Link href={taskHrefBuilder(task.id)} className="block min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
            {task.incident?.code ?? "Standalone"}
            <span className={cn("h-2 w-2 rounded-full", priority.dot)} />
          </div>
          <h3 className="mt-2 text-sm font-medium leading-6 text-white transition group-hover:text-cyan-50">
            {task.title}
          </h3>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                due.tone,
              )}
            >
              {due.label}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-slate-300">
              {task.assignee?.fullName ?? "Unassigned"}
            </span>
          </div>
        </Link>
        <div className="flex shrink-0 items-start gap-2">
          <div
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              priority.chip,
            )}
          >
            P{task.priority}
          </div>
          {dragHandle}
        </div>
      </div>
    </div>
  );
}

function SortableTaskCard({
  task,
  selectedTaskId,
  interactive,
  taskHrefBuilder,
}: {
  task: TaskDto;
  selectedTaskId?: string | null;
  interactive: boolean;
  taskHrefBuilder: (taskId: string) => string;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: task.id,
    disabled: !interactive,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-55")}
    >
      <TaskCardBody
        task={task}
        selectedTaskId={selectedTaskId}
        taskHrefBuilder={taskHrefBuilder}
        dragHandle={
          interactive ? (
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label={`Drag ${task.title}`}
              className="inline-flex h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-slate-400 transition hover:border-cyan-300/30 hover:text-cyan-100 active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : null
        }
      />
    </div>
  );
}

function BoardColumn({
  statusKey,
  tasks,
  selectedTaskId,
  maxPerColumn,
  interactive,
  taskHrefBuilder,
}: {
  statusKey: TaskBoardColumnKey;
  tasks: TaskDto[];
  selectedTaskId?: string | null;
  maxPerColumn?: number;
  interactive: boolean;
  taskHrefBuilder: (taskId: string) => string;
}) {
  const meta = TASK_STATUS_META[statusKey];
  const renderedTasks =
    typeof maxPerColumn === "number" ? tasks.slice(0, maxPerColumn) : tasks;
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${statusKey}`,
    disabled: !interactive,
  });

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/4 p-3">
      <div
        className={cn(
          "rounded-[22px] border bg-gradient-to-br px-4 py-3",
          meta.tone,
          meta.accent,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{meta.label}</h3>
          <span className="rounded-full border border-white/10 bg-black/15 px-2.5 py-1 text-[11px] font-semibold text-white/80">
            {tasks.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "mt-3 min-h-28 space-y-3 rounded-[24px] transition",
          interactive && isOver && "bg-cyan-300/6 ring-1 ring-cyan-300/18",
        )}
      >
        <SortableContext
          items={renderedTasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {renderedTasks.length > 0 ? (
            renderedTasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                selectedTaskId={selectedTaskId}
                interactive={interactive}
                taskHrefBuilder={taskHrefBuilder}
              />
            ))
          ) : (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
              {interactive ? "Drop task here." : "No tasks in this lane."}
            </div>
          )}
        </SortableContext>
      </div>
    </section>
  );
}

export function TaskStatusBoard({
  board,
  selectedTaskId,
  maxPerColumn,
  interactive = false,
  taskHrefBuilder = getTaskHref,
}: TaskStatusBoardProps) {
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const [optimisticBoard, setOptimisticBoard] = useState<TaskBoardDto | null>(
    null,
  );
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const boardSignature = getTaskBoardSignature(board);
  const optimisticSignature = optimisticBoard
    ? getTaskBoardSignature(optimisticBoard)
    : null;
  const displayedBoard =
    optimisticBoard &&
    (activeTaskId !== null || isPending || optimisticSignature !== boardSignature)
      ? optimisticBoard
      : board;
  const boardInteractive = interactive && !isPending;
  const activeTask = activeTaskId
    ? findTaskLocation(displayedBoard, activeTaskId)
    : null;

  function handleDragStart(event: DragStartEvent) {
    if (!boardInteractive) {
      return;
    }

    setFeedback(null);
    setActiveTaskId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);

    if (!boardInteractive || !event.over) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const source = findTaskLocation(displayedBoard, activeId);
    const target = resolveDropTarget(displayedBoard, overId);

    if (!source || !target) {
      return;
    }

    if (source.columnKey === target.columnKey && source.index === target.index) {
      return;
    }

    const nextBoard = moveTask(displayedBoard, source, target);
    const nextLocation = findTaskLocation(nextBoard, activeId);

    if (!nextLocation) {
      return;
    }

    setOptimisticBoard(nextBoard);

    startTransition(async () => {
      const result = await reorderTaskBoardAction({
        taskId: activeId,
        sourceStatus: source.task.status,
        targetStatus: BOARD_KEY_TO_TASK_STATUS[target.columnKey],
        position: nextLocation.index,
      });

      if (!result.ok) {
        setOptimisticBoard(null);
        setFeedback(result.message ?? "Board move failed.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTaskId(null)}
    >
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[rgba(12,16,26,0.88)] shadow-[0_30px_90px_rgba(0,0,0,0.22)]">
        <div className="border-b border-white/10 px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500">
            Task board
          </p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-medium text-white">Status lanes</h2>
              <p className="mt-1 text-sm text-slate-400">
                {boardInteractive
                  ? "Drag by the grip handle to reorder inside a lane or move across lanes when policy allows."
                  : "Live operational queue grouped by transition state."}
              </p>
            </div>
            {boardInteractive ? (
              <div className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
                {isPending ? "Saving board move..." : "Drag enabled"}
              </div>
            ) : interactive ? (
              <div className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-50">
                Syncing board...
              </div>
            ) : null}
          </div>
        </div>

        {feedback ? (
          <div className="border-b border-rose-400/20 bg-rose-400/10 px-6 py-3 text-sm text-rose-100">
            {feedback}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <div className="grid min-w-[1220px] grid-cols-6 gap-4 px-4 py-4">
            {TASK_STATUS_ORDER.map((statusKey) => (
              <BoardColumn
                key={statusKey}
                statusKey={statusKey}
                tasks={displayedBoard[statusKey] ?? []}
                selectedTaskId={selectedTaskId}
                maxPerColumn={maxPerColumn}
                interactive={boardInteractive}
                taskHrefBuilder={taskHrefBuilder}
              />
            ))}
          </div>
        </div>
      </section>

      <DragOverlay>
        {activeTask ? (
          <div className="w-[280px] rotate-[1.2deg] opacity-95">
            <TaskCardBody
              task={{
                ...activeTask.task,
                status: BOARD_KEY_TO_TASK_STATUS[activeTask.columnKey],
              }}
              selectedTaskId={selectedTaskId}
              taskHrefBuilder={taskHrefBuilder}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

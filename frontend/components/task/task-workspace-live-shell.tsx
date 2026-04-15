"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  startTransition,
} from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TaskControlPanel } from "@/components/task/task-control-panel";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { TaskKpiStrip } from "@/components/task/task-kpi-strip";
import { TaskRailList } from "@/components/task/task-rail-list";
import { TaskStatusBoard } from "@/components/task/task-status-board";
import {
  describeRealtimeEvent,
  extractTouchedTaskIds,
  type FrontendRealtimeEvent,
} from "@/lib/realtime";
import {
  formatTaskRelative,
  getTaskBoardSignature,
  type TaskWorkspace,
} from "@/lib/api/task-workspace";
import { cn } from "@/lib/utils";

type TaskWorkspaceRefreshResponse = {
  data: TaskWorkspace;
  fetchedAt: string;
};

type TaskWorkspaceLiveShellProps = {
  initialWorkspace: TaskWorkspace;
  initialFetchedAt: string;
  taskId?: string;
  incidentId?: string;
  defaultIncidentId?: string | null;
  redirectBasePath?: string;
  selectedTaskRedirectPath?: string;
  taskHrefBuilder?: (taskId: string) => string;
  myTasksTitle?: string;
  myTasksSubtitle?: string;
  myTasksEmptyLabel?: string;
  overdueTitle?: string;
  overdueSubtitle?: string;
  overdueEmptyLabel?: string;
};

function getErrorMessage(body: unknown, status: number) {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }

  if (body && typeof body === "object") {
    const message =
      "message" in body
        ? (body as { message?: string | string[] }).message
        : undefined;

    if (Array.isArray(message) && message.length > 0) {
      return message.join(", ");
    }

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return `Request failed with status ${status}.`;
}

async function requestTaskWorkspace(options: {
  taskId?: string;
  incidentId?: string;
}) {
  const searchParams = new URLSearchParams();

  if (options.taskId) {
    searchParams.set("taskId", options.taskId);
  }
  if (options.incidentId) {
    searchParams.set("incidentId", options.incidentId);
  }

  const response = await fetch(
    `/api/tasks/workspace?${searchParams.toString()}`,
    {
      cache: "no-store",
    },
  );
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, response.status));
  }

  return body as TaskWorkspaceRefreshResponse;
}

export function TaskWorkspaceLiveShell({
  initialWorkspace,
  initialFetchedAt,
  taskId,
  incidentId,
  defaultIncidentId,
  redirectBasePath = "/tasks",
  selectedTaskRedirectPath,
  taskHrefBuilder,
  myTasksTitle = "My tasks",
  myTasksSubtitle = "Assigned queue for the current operator",
  myTasksEmptyLabel = "No tasks are currently assigned.",
  overdueTitle = "Overdue tasks",
  overdueSubtitle = "Tasks outside the due window and still non-terminal",
  overdueEmptyLabel = "No overdue tasks are visible.",
}: TaskWorkspaceLiveShellProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [lastSyncedAt, setLastSyncedAt] = useState(initialFetchedAt);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [highlightedTaskIds, setHighlightedTaskIds] = useState<string[]>([]);
  const refreshInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const highlightTimeoutRef = useRef<number | null>(null);
  const canRefresh = workspace.source === "api";

  useEffect(() => {
    setWorkspace(initialWorkspace);
    setLastSyncedAt(initialFetchedAt);
    setError(null);
    setStreamState(initialWorkspace.source === "api" ? "connecting" : "offline");
    setHighlightedTaskIds([]);
  }, [incidentId, initialFetchedAt, initialWorkspace, taskId]);

  async function performRefresh(manual = false) {
    if (!canRefresh) {
      return;
    }
    if (refreshInFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    if (!manual && typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    refreshInFlightRef.current = true;
    setIsRefreshing(true);

    try {
      const payload = await requestTaskWorkspace({
        taskId: taskId ?? workspace.selectedTask?.id ?? undefined,
        incidentId,
      });

      if (payload.data.source !== "api" && workspace.source === "api") {
        setError("Live task refresh is temporarily unavailable. Keeping last live snapshot.");
        return;
      }

      startTransition(() => {
        setWorkspace(payload.data);
        setLastSyncedAt(payload.fetchedAt);
        setError(null);
        setStreamState("live");
      });
    } catch (refreshError) {
      setStreamState("offline");
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Task workspace refresh failed unexpectedly.",
      );
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void performRefresh(true);
      }
    }
  }

  const handleStreamRefresh = useEffectEvent(async () => {
    await performRefresh(true);
  });

  const registerLiveEvent = useEffectEvent((event: FrontendRealtimeEvent) => {
    const touchedTaskIds = extractTouchedTaskIds(event);

    if (touchedTaskIds.length > 0) {
      setHighlightedTaskIds(touchedTaskIds);
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedTaskIds([]);
      }, 3200);
    }

    const copy = describeRealtimeEvent(event);
    toast(copy.title, {
      id: `${event.event}:${event.taskId ?? event.incidentId ?? "workspace"}:${event.emittedAt ?? Date.now()}`,
      description: copy.description,
    });
  });

  useEffect(() => {
    if (!canRefresh) {
      return;
    }

    setStreamState("connecting");
    const searchParams = new URLSearchParams();

    if (incidentId) {
      searchParams.set("incidentId", incidentId);
    }
    if (taskId) {
      searchParams.set("taskId", taskId);
    }

    const eventSource = new EventSource(
      `/api/tasks/stream${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
    );

    eventSource.onopen = () => {
      setStreamState("live");
      setError(null);
    };

    eventSource.onerror = () => {
      setStreamState("offline");
      setError("Live task stream disconnected. Waiting for automatic reconnect.");
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as FrontendRealtimeEvent;
        if (payload.event === "heartbeat") {
          return;
        }
        registerLiveEvent(payload);
      } catch {
        // Ignore parse failures and fall through to a conservative refresh.
      }
      void handleStreamRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void handleStreamRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      eventSource.close();
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, [canRefresh, incidentId, taskId]);

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/10 bg-[rgba(12,16,26,0.82)] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.18)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
              Live task feed
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {canRefresh
                ? "Board, queues, and selected task detail now refresh from a live event stream instead of timer polling."
                : "Task workspace is running in mock fallback mode and stays read-only."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
              {canRefresh
                ? `${streamState === "live" ? "Live stream" : streamState === "connecting" ? "Connecting..." : "Reconnecting..."} · synced ${formatTaskRelative(lastSyncedAt)}`
                : "Mock workspace"}
            </div>
            {canRefresh ? (
              <button
                type="button"
                onClick={() => void performRefresh(true)}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  className={cn("h-4 w-4", isRefreshing && "animate-spin")}
                />
                {isRefreshing ? "Refreshing..." : "Refresh now"}
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-[22px] border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
      </section>

      <TaskKpiStrip
        board={workspace.board}
        myTasks={workspace.myTasks}
        overdueTasks={workspace.overdueTasks}
        selectedTask={workspace.selectedTask}
      />

      <section className="grid gap-6 2xl:grid-cols-[1.5fr_0.9fr]">
        <div className="space-y-6">
          <TaskStatusBoard
            key={getTaskBoardSignature(workspace.board)}
            board={workspace.board}
            selectedTaskId={workspace.selectedTask?.id}
            highlightedTaskIds={highlightedTaskIds}
            interactive={workspace.source === "api"}
            taskHrefBuilder={taskHrefBuilder}
          />

          <div className="grid gap-6 xl:grid-cols-2">
            <TaskRailList
              title={myTasksTitle}
              subtitle={myTasksSubtitle}
              tasks={workspace.myTasks}
              selectedTaskId={workspace.selectedTask?.id}
              emptyLabel={myTasksEmptyLabel}
              taskHrefBuilder={taskHrefBuilder}
            />
            <TaskRailList
              title={overdueTitle}
              subtitle={overdueSubtitle}
              tasks={workspace.overdueTasks}
              selectedTaskId={workspace.selectedTask?.id}
              emptyLabel={overdueEmptyLabel}
              tone="danger"
              taskHrefBuilder={taskHrefBuilder}
            />
          </div>
        </div>

        <div className="space-y-6">
          <TaskControlPanel
            key={
              workspace.selectedTask
                ? `${workspace.selectedTask.id}:${workspace.selectedTask.updatedAt}:${workspace.selectedTask.assigneeId ?? "none"}`
                : "task-controls"
            }
            source={workspace.source}
            selectedTask={workspace.selectedTask}
            visibleIncidents={workspace.visibleIncidents}
            visibleUsers={workspace.visibleUsers}
            availableTransitions={workspace.availableTransitions}
            defaultIncidentId={defaultIncidentId}
            redirectBasePath={redirectBasePath}
            selectedTaskRedirectPath={selectedTaskRedirectPath}
          />
          <TaskDetailPanel task={workspace.selectedTask} />
        </div>
      </section>
    </div>
  );
}

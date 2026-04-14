import { format, formatDistanceToNowStrict, isPast } from "date-fns";

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "cancelled";

export type TaskPriority = 1 | 2 | 3 | 4;

export type TaskTransitionCode =
  | "start"
  | "block"
  | "unblock"
  | "submit_for_review"
  | "complete"
  | "approve"
  | "reject"
  | "cancel";

export type UserSummary = {
  id: string;
  fullName: string;
  email?: string | null;
};

export type IncidentSummary = {
  id: string;
  code: string;
  title: string;
  status: string;
  severity: number;
  commanderId?: string | null;
};

export type TaskDto = {
  id: string;
  tenantId: string;
  incidentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assignerId: string;
  dueAt: string | null;
  slaBreachAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  parentTaskId: string | null;
  position: number;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  incident?: IncidentSummary | null;
  assignee?: UserSummary | null;
  assigner?: UserSummary | null;
};

export type TaskCommentDto = {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author?: UserSummary | null;
};

export type TaskAssignmentDto = {
  id: string;
  taskId: string;
  assigneeId: string | null;
  assignedBy: string;
  reason: string | null;
  assignedAt: string;
  assignee?: UserSummary | null;
  assignedByUser?: UserSummary | null;
};

export type AvailableTransitionDto = {
  code: TaskTransitionCode;
  label: string;
  requires: string[];
};

export type TaskDetailDto = TaskDto & {
  subtasks: TaskDto[];
  latestComments: TaskCommentDto[];
  assignmentHistory: TaskAssignmentDto[];
  stats: {
    subtaskCount: number;
    completedSubtaskCount: number;
    commentCount: number;
    dependencyCount: number;
  };
};

export type TaskBoardDto = {
  todo: TaskDto[];
  inProgress: TaskDto[];
  blocked: TaskDto[];
  review: TaskDto[];
  done: TaskDto[];
  cancelled: TaskDto[];
};

export type TaskBoardColumnKey = keyof TaskBoardDto;

export type TaskWorkspace = {
  source: "api" | "mock";
  board: TaskBoardDto;
  myTasks: TaskDto[];
  overdueTasks: TaskDto[];
  selectedTask: TaskDetailDto | null;
  availableTransitions: AvailableTransitionDto[];
  visibleIncidents: IncidentSummary[];
  visibleUsers: UserSummary[];
  highlightedIncident: IncidentSummary | null;
  refreshedAt: string;
};

export const TASK_STATUS_ORDER: TaskBoardColumnKey[] = [
  "todo",
  "inProgress",
  "blocked",
  "review",
  "done",
  "cancelled",
];

export const BOARD_KEY_TO_TASK_STATUS: Record<TaskBoardColumnKey, TaskStatus> = {
  todo: "todo",
  inProgress: "in_progress",
  blocked: "blocked",
  review: "review",
  done: "done",
  cancelled: "cancelled",
};

export const TASK_STATUS_TO_BOARD_KEY: Record<TaskStatus, TaskBoardColumnKey> = {
  todo: "todo",
  in_progress: "inProgress",
  blocked: "blocked",
  review: "review",
  done: "done",
  cancelled: "cancelled",
};

export const TASK_STATUS_META: Record<
  TaskBoardColumnKey,
  { label: string; tone: string; accent: string }
> = {
  todo: {
    label: "To Do",
    tone: "border-lime-400/50 bg-lime-400/8 text-lime-100",
    accent: "from-lime-300/25 to-lime-400/5",
  },
  inProgress: {
    label: "In Progress",
    tone: "border-sky-400/50 bg-sky-400/8 text-sky-100",
    accent: "from-sky-300/25 to-sky-400/5",
  },
  blocked: {
    label: "Blocked",
    tone: "border-rose-400/60 bg-rose-400/10 text-rose-100",
    accent: "from-rose-300/25 to-rose-400/5",
  },
  review: {
    label: "Review",
    tone: "border-amber-400/60 bg-amber-400/10 text-amber-100",
    accent: "from-amber-300/25 to-amber-400/5",
  },
  done: {
    label: "Done",
    tone: "border-emerald-400/55 bg-emerald-400/9 text-emerald-100",
    accent: "from-emerald-300/25 to-emerald-400/5",
  },
  cancelled: {
    label: "Cancelled",
    tone: "border-zinc-500/55 bg-zinc-500/10 text-zinc-200",
    accent: "from-zinc-400/20 to-zinc-500/5",
  },
};

export const TASK_PRIORITY_META: Record<
  TaskPriority,
  { label: string; dot: string; chip: string }
> = {
  1: {
    label: "Critical",
    dot: "bg-rose-400",
    chip: "border-rose-400/50 bg-rose-400/10 text-rose-100",
  },
  2: {
    label: "High",
    dot: "bg-orange-400",
    chip: "border-orange-400/50 bg-orange-400/10 text-orange-100",
  },
  3: {
    label: "Medium",
    dot: "bg-amber-300",
    chip: "border-amber-300/50 bg-amber-300/10 text-amber-50",
  },
  4: {
    label: "Low",
    dot: "bg-emerald-300",
    chip: "border-emerald-300/45 bg-emerald-300/10 text-emerald-50",
  },
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const API_TOKEN =
  process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

const currentUser: UserSummary = {
  id: "user-1",
  fullName: "Rustam Nazarov",
  email: "rustam.nazarov@coescd.local",
};

const assigner: UserSummary = {
  id: "user-2",
  fullName: "Dilafruz Safarova",
  email: "d.safarova@coescd.local",
};

const deputy: UserSummary = {
  id: "user-3",
  fullName: "Bakhtiyor Akhmedov",
  email: "b.akhmedov@coescd.local",
};

const incidents: IncidentSummary[] = [
  {
    id: "incident-1",
    code: "FL-2026-04-0001",
    title: "Flash flood response across district center",
    status: "open",
    severity: 3,
    commanderId: currentUser.id,
  },
  {
    id: "incident-2",
    code: "WF-2026-04-0007",
    title: "Wildfire perimeter stabilization in ridge sector",
    status: "escalated",
    severity: 4,
    commanderId: deputy.id,
  },
];

const mockBoardTasks: TaskDto[] = [
  {
    id: "task-101",
    tenantId: "tenant-1",
    incidentId: incidents[0].id,
    title: "Deploy water rescue teams to the eastern floodplain",
    description:
      "Move both high-water vehicles and one medical support team to the eastern sector before the next river rise.",
    status: "in_progress",
    priority: 1,
    assigneeId: currentUser.id,
    assignerId: assigner.id,
    dueAt: "2026-04-14T08:15:00.000Z",
    slaBreachAt: "2026-04-14T08:30:00.000Z",
    startedAt: "2026-04-14T07:05:00.000Z",
    completedAt: null,
    parentTaskId: null,
    position: 0,
    metadata: {
      sector: "East-3",
      channel: "ops-flood-east",
    },
    createdBy: assigner.id,
    createdAt: "2026-04-14T06:25:00.000Z",
    updatedAt: "2026-04-14T07:20:00.000Z",
    incident: incidents[0],
    assignee: currentUser,
    assigner,
  },
  {
    id: "task-102",
    tenantId: "tenant-1",
    incidentId: incidents[0].id,
    title: "Open temporary shelter at School No. 8 gymnasium",
    description:
      "Coordinate electricity, registration desk, and family tracing support before 10:00.",
    status: "todo",
    priority: 2,
    assigneeId: deputy.id,
    assignerId: currentUser.id,
    dueAt: "2026-04-14T09:00:00.000Z",
    slaBreachAt: "2026-04-14T09:20:00.000Z",
    startedAt: null,
    completedAt: null,
    parentTaskId: null,
    position: 0,
    metadata: {
      shelterCode: "SH-08",
    },
    createdBy: currentUser.id,
    createdAt: "2026-04-14T06:10:00.000Z",
    updatedAt: "2026-04-14T06:45:00.000Z",
    incident: incidents[0],
    assignee: deputy,
    assigner: currentUser,
  },
  {
    id: "task-103",
    tenantId: "tenant-1",
    incidentId: incidents[1].id,
    title: "Confirm fuel rotation for ridge suppression vehicles",
    description:
      "Fuel convoy ETA slipped. Verify alternate pickup point and update dispatch.",
    status: "blocked",
    priority: 2,
    assigneeId: currentUser.id,
    assignerId: deputy.id,
    dueAt: "2026-04-14T07:20:00.000Z",
    slaBreachAt: "2026-04-14T07:45:00.000Z",
    startedAt: "2026-04-14T06:20:00.000Z",
    completedAt: null,
    parentTaskId: null,
    position: 0,
    metadata: {
      blocker: "Fuel convoy reroute",
    },
    createdBy: deputy.id,
    createdAt: "2026-04-14T05:55:00.000Z",
    updatedAt: "2026-04-14T07:12:00.000Z",
    incident: incidents[1],
    assignee: currentUser,
    assigner: deputy,
  },
  {
    id: "task-104",
    tenantId: "tenant-1",
    incidentId: incidents[0].id,
    title: "Submit municipal sitrep package for flood shelter capacity",
    description:
      "Review shelter occupancy numbers and forward the signed package to city coordination.",
    status: "review",
    priority: 3,
    assigneeId: deputy.id,
    assignerId: currentUser.id,
    dueAt: "2026-04-14T08:40:00.000Z",
    slaBreachAt: "2026-04-14T08:50:00.000Z",
    startedAt: "2026-04-14T07:30:00.000Z",
    completedAt: null,
    parentTaskId: null,
    position: 0,
    metadata: {},
    createdBy: currentUser.id,
    createdAt: "2026-04-14T06:50:00.000Z",
    updatedAt: "2026-04-14T08:00:00.000Z",
    incident: incidents[0],
    assignee: deputy,
    assigner: currentUser,
  },
  {
    id: "task-105",
    tenantId: "tenant-1",
    incidentId: incidents[1].id,
    title: "Approve western ridge evacuation notice",
    description:
      "Final sign-off completed. Push translated notice to alerting teams and radio desk.",
    status: "done",
    priority: 1,
    assigneeId: currentUser.id,
    assignerId: deputy.id,
    dueAt: "2026-04-14T06:45:00.000Z",
    slaBreachAt: "2026-04-14T07:00:00.000Z",
    startedAt: "2026-04-14T05:40:00.000Z",
    completedAt: "2026-04-14T06:31:00.000Z",
    parentTaskId: null,
    position: 0,
    metadata: {},
    createdBy: deputy.id,
    createdAt: "2026-04-14T05:20:00.000Z",
    updatedAt: "2026-04-14T06:31:00.000Z",
    incident: incidents[1],
    assignee: currentUser,
    assigner: deputy,
  },
  {
    id: "task-106",
    tenantId: "tenant-1",
    incidentId: null,
    title: "Cancel reserve convoy dispatch to old warehouse route",
    description:
      "Old route is no longer viable after bridge inspection failed overnight.",
    status: "cancelled",
    priority: 4,
    assigneeId: null,
    assignerId: currentUser.id,
    dueAt: null,
    slaBreachAt: null,
    startedAt: null,
    completedAt: null,
    parentTaskId: null,
    position: 0,
    metadata: {},
    createdBy: currentUser.id,
    createdAt: "2026-04-14T03:00:00.000Z",
    updatedAt: "2026-04-14T04:20:00.000Z",
    incident: null,
    assignee: null,
    assigner: currentUser,
  },
  {
    id: "task-107",
    tenantId: "tenant-1",
    incidentId: incidents[0].id,
    title: "Verify generator fuel at school shelter",
    description:
      "A quick subtask before the shelter is opened for overnight intake.",
    status: "done",
    priority: 3,
    assigneeId: currentUser.id,
    assignerId: deputy.id,
    dueAt: "2026-04-14T07:50:00.000Z",
    slaBreachAt: null,
    startedAt: "2026-04-14T07:05:00.000Z",
    completedAt: "2026-04-14T07:35:00.000Z",
    parentTaskId: "task-102",
    position: 0,
    metadata: {},
    createdBy: deputy.id,
    createdAt: "2026-04-14T06:55:00.000Z",
    updatedAt: "2026-04-14T07:35:00.000Z",
    incident: incidents[0],
    assignee: currentUser,
    assigner: deputy,
  },
];

const mockComments: Record<string, TaskCommentDto[]> = {
  "task-101": [
    {
      id: "comment-1",
      taskId: "task-101",
      authorId: deputy.id,
      body: "Water level at bridge crossing is still rising. Consider shifting staging 400m south.",
      createdAt: "2026-04-14T07:18:00.000Z",
      updatedAt: "2026-04-14T07:18:00.000Z",
      author: deputy,
    },
    {
      id: "comment-2",
      taskId: "task-101",
      authorId: currentUser.id,
      body: "Two boats are already moving. Medical support ETA 12 minutes.",
      createdAt: "2026-04-14T07:24:00.000Z",
      updatedAt: "2026-04-14T07:24:00.000Z",
      author: currentUser,
    },
  ],
  "task-103": [
    {
      id: "comment-3",
      taskId: "task-103",
      authorId: currentUser.id,
      body: "Blocked until transport confirms reroute from depot B.",
      createdAt: "2026-04-14T07:12:00.000Z",
      updatedAt: "2026-04-14T07:12:00.000Z",
      author: currentUser,
    },
  ],
};

const mockAssignmentHistory: Record<string, TaskAssignmentDto[]> = {
  "task-101": [
    {
      id: "assign-1",
      taskId: "task-101",
      assigneeId: currentUser.id,
      assignedBy: assigner.id,
      reason: "Direct command to field coordination lead",
      assignedAt: "2026-04-14T06:30:00.000Z",
      assignee: currentUser,
      assignedByUser: assigner,
    },
  ],
  "task-102": [
    {
      id: "assign-2",
      taskId: "task-102",
      assigneeId: deputy.id,
      assignedBy: currentUser.id,
      reason: "Shelter setup lead",
      assignedAt: "2026-04-14T06:15:00.000Z",
      assignee: deputy,
      assignedByUser: currentUser,
    },
  ],
};

async function fetchApi<T>(path: string): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(2500),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function buildQueryString(
  params: Record<string, string | number | null | undefined>,
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function flattenBoard(board: TaskBoardDto): TaskDto[] {
  return [
    ...board.todo,
    ...board.inProgress,
    ...board.blocked,
    ...board.review,
    ...board.done,
    ...board.cancelled,
  ];
}

function emptyBoard(): TaskBoardDto {
  return {
    todo: [],
    inProgress: [],
    blocked: [],
    review: [],
    done: [],
    cancelled: [],
  };
}

function uniqueById<T extends { id: string }>(items: Array<T | null | undefined>) {
  const registry = new Map<string, T>();

  for (const item of items) {
    if (item && !registry.has(item.id)) {
      registry.set(item.id, item);
    }
  }

  return Array.from(registry.values());
}

function collectVisibleIncidents(
  tasks: TaskDto[],
  selectedTask: TaskDetailDto | null,
) {
  return uniqueById<IncidentSummary>([
    ...tasks.map((task) => task.incident ?? null),
    selectedTask?.incident ?? null,
    ...(selectedTask?.subtasks.map((task) => task.incident ?? null) ?? []),
  ]).sort((left, right) => left.code.localeCompare(right.code));
}

function collectVisibleUsers(tasks: TaskDto[], selectedTask: TaskDetailDto | null) {
  return uniqueById<UserSummary>([
    ...tasks.flatMap((task) => [task.assignee ?? null, task.assigner ?? null]),
    ...(selectedTask
      ? [
          selectedTask.assignee ?? null,
          selectedTask.assigner ?? null,
          ...selectedTask.subtasks.flatMap((task) => [
            task.assignee ?? null,
            task.assigner ?? null,
          ]),
          ...selectedTask.latestComments.map((comment) => comment.author ?? null),
          ...selectedTask.assignmentHistory.flatMap((entry) => [
            entry.assignee ?? null,
            entry.assignedByUser ?? null,
          ]),
        ]
      : []),
  ]).sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function boardFromTasks(tasks: TaskDto[]): TaskBoardDto {
  return {
    todo: tasks.filter((task) => task.status === "todo"),
    inProgress: tasks.filter((task) => task.status === "in_progress"),
    blocked: tasks.filter((task) => task.status === "blocked"),
    review: tasks.filter((task) => task.status === "review"),
    done: tasks.filter((task) => task.status === "done"),
    cancelled: tasks.filter((task) => task.status === "cancelled"),
  };
}

function toTaskDetail(task: TaskDto): TaskDetailDto {
  const subtasks = mockBoardTasks.filter((item) => item.parentTaskId === task.id);
  const latestComments = mockComments[task.id] ?? [];
  const assignmentHistory = mockAssignmentHistory[task.id] ?? [];

  return {
    ...task,
    subtasks,
    latestComments,
    assignmentHistory,
    stats: {
      subtaskCount: subtasks.length,
      completedSubtaskCount: subtasks.filter((item) => item.status === "done").length,
      commentCount: latestComments.length,
      dependencyCount: 0,
    },
  };
}

function pickHighlightedIncident(tasks: TaskDto[], selectedTask: TaskDetailDto | null) {
  if (selectedTask?.incident) {
    return selectedTask.incident;
  }

  return tasks.find((task) => task.incident)?.incident ?? null;
}

function filterMockTasks(taskId?: string, incidentId?: string) {
  const scopedTasks = mockBoardTasks.filter(
    (task) => !incidentId || task.incidentId === incidentId,
  );
  const topLevelTasks = scopedTasks.filter((task) => task.parentTaskId === null);
  const board = boardFromTasks(topLevelTasks);
  const myTasks = mockBoardTasks.filter(
    (task) =>
      (!incidentId || task.incidentId === incidentId) &&
      task.assigneeId === currentUser.id &&
      task.parentTaskId === null &&
      task.status !== "done" &&
      task.status !== "cancelled",
  );
  const overdueTasks = mockBoardTasks.filter(
    (task) =>
      (!incidentId || task.incidentId === incidentId) &&
      task.parentTaskId === null &&
      task.dueAt &&
      isPast(new Date(task.dueAt)) &&
      task.status !== "done" &&
      task.status !== "cancelled",
  );

  const selectedSource =
    scopedTasks.find((task) => task.id === taskId) ??
    flattenBoard(board).find((task) => task.status !== "done" && task.status !== "cancelled") ??
    flattenBoard(board)[0] ??
    null;

  const selectedTask = selectedSource ? toTaskDetail(selectedSource) : null;

  return {
    board,
    myTasks,
    overdueTasks,
    selectedTask,
  };
}

function normalizeBoard(data: Partial<TaskBoardDto> | undefined): TaskBoardDto {
  const board = data ?? emptyBoard();

  return {
    todo: board.todo ?? [],
    inProgress: board.inProgress ?? [],
    blocked: board.blocked ?? [],
    review: board.review ?? [],
    done: board.done ?? [],
    cancelled: board.cancelled ?? [],
  };
}

export async function loadTaskWorkspace(options?: {
  taskId?: string;
  incidentId?: string;
}): Promise<TaskWorkspace> {
  const refreshedAt = format(new Date(), "HH:mm 'UTC'");
  const query = buildQueryString({ incidentId: options?.incidentId });

  try {
    const [boardResponse, myResponse, overdueResponse] = await Promise.all([
      fetchApi<{ data: TaskBoardDto }>(`/tasks/board${query}`),
      fetchApi<{ data: TaskDto[] }>(`/tasks/my${query}`),
      fetchApi<{ data: TaskDto[] }>(`/tasks/overdue${query}`),
    ]);

    const board = normalizeBoard(boardResponse.data);
    const allVisible = flattenBoard(board);
    const selectedTaskId = options?.taskId ?? allVisible[0]?.id ?? myResponse.data[0]?.id;
    let selectedTask: TaskDetailDto | null = null;
    let availableTransitions: AvailableTransitionDto[] = [];

    if (selectedTaskId) {
      try {
        const detailResponse = await fetchApi<{ data: TaskDetailDto }>(
          `/tasks/${selectedTaskId}`,
        );
        selectedTask = detailResponse.data;
      } catch {
        const fallbackTask =
          [...allVisible, ...myResponse.data, ...overdueResponse.data].find(
            (task) => task.id === selectedTaskId,
          ) ?? null;
        selectedTask = fallbackTask
          ? {
              ...fallbackTask,
              subtasks: [],
              latestComments: [],
              assignmentHistory: [],
              stats: {
                subtaskCount: 0,
                completedSubtaskCount: 0,
                commentCount: 0,
                dependencyCount: 0,
              },
            }
          : null;
      }

      try {
        const transitionsResponse = await fetchApi<{ data: AvailableTransitionDto[] }>(
          `/tasks/${selectedTaskId}/transitions/available`,
        );
        availableTransitions = transitionsResponse.data ?? [];
      } catch {
        availableTransitions = [];
      }
    }

    const visibleTasks = [...allVisible, ...myResponse.data, ...overdueResponse.data];

    return {
      source: "api",
      board,
      myTasks: myResponse.data,
      overdueTasks: overdueResponse.data,
      selectedTask,
      availableTransitions,
      visibleIncidents: collectVisibleIncidents(visibleTasks, selectedTask),
      visibleUsers: collectVisibleUsers(visibleTasks, selectedTask),
      highlightedIncident: pickHighlightedIncident(allVisible, selectedTask),
      refreshedAt,
    };
  } catch {
    const mock = filterMockTasks(options?.taskId, options?.incidentId);
    const visibleTasks = [
      ...flattenBoard(mock.board),
      ...mock.myTasks,
      ...mock.overdueTasks,
    ];

    return {
      source: "mock",
      board: mock.board,
      myTasks: mock.myTasks,
      overdueTasks: mock.overdueTasks,
      selectedTask: mock.selectedTask,
      availableTransitions: [],
      visibleIncidents: collectVisibleIncidents(visibleTasks, mock.selectedTask),
      visibleUsers: collectVisibleUsers(visibleTasks, mock.selectedTask),
      highlightedIncident: pickHighlightedIncident(
        flattenBoard(mock.board),
        mock.selectedTask,
      ),
      refreshedAt,
    };
  }
}

export function getTaskHref(taskId: string) {
  return `/tasks?taskId=${taskId}`;
}

export function formatTaskTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return format(new Date(value), "dd MMM · HH:mm");
}

export function formatTaskRelative(value: string | null | undefined) {
  if (!value) {
    return "No timestamp";
  }

  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export function getDueState(task: TaskDto) {
  if (!task.dueAt) {
    return {
      label: "No due time",
      tone: "border-white/10 bg-white/5 text-slate-300",
      overdue: false,
    };
  }

  const dueAt = new Date(task.dueAt);
  const overdue =
    isPast(dueAt) && task.status !== "done" && task.status !== "cancelled";

  return {
    label: overdue
      ? `Overdue · ${formatTaskTimestamp(task.dueAt)}`
      : `Due · ${formatTaskTimestamp(task.dueAt)}`,
    tone: overdue
      ? "border-rose-400/50 bg-rose-400/10 text-rose-100"
      : "border-sky-400/35 bg-sky-400/10 text-sky-100",
    overdue,
  };
}

export function getTaskCompletionRatio(task: TaskDetailDto | null) {
  if (!task || task.stats.subtaskCount === 0) {
    return 0;
  }

  return Math.round(
    (task.stats.completedSubtaskCount / task.stats.subtaskCount) * 100,
  );
}

export function countBoardTasks(board: TaskBoardDto) {
  return flattenBoard(board).length;
}

export function getTaskBoardSignature(board: TaskBoardDto) {
  return TASK_STATUS_ORDER.map((statusKey) =>
    board[statusKey]
      .map(
        (task) =>
          `${task.id}:${task.position}:${task.status}:${task.updatedAt}:${task.assigneeId ?? "none"}`,
      )
      .join("|"),
  ).join("::");
}

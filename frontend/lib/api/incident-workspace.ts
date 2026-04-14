import {
  loadTaskWorkspace,
  type IncidentSummary,
  type TaskWorkspace,
  type UserSummary,
} from "@/lib/api/task-workspace";

export const INCIDENT_CATEGORY_OPTIONS = [
  "earthquake",
  "flood",
  "fire",
  "wildfire",
  "industrial",
  "cbrn",
  "mass_gathering",
  "medical",
  "transport",
  "other",
] as const;

export const INCIDENT_STATUS_OPTIONS = [
  "draft",
  "open",
  "escalated",
  "contained",
  "closed",
  "archived",
] as const;

export const INCIDENT_SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "updated", label: "Recently updated" },
  { value: "severity_desc", label: "Severity high to low" },
  { value: "severity_asc", label: "Severity low to high" },
  { value: "code_asc", label: "Incident code A-Z" },
] as const;

export type IncidentTransitionCode =
  | "open"
  | "escalate"
  | "de_escalate"
  | "contain"
  | "close"
  | "reopen"
  | "archive";

export type IncidentCursorPageDto = {
  nextCursor: string | null;
  prevCursor: string | null;
  limit: number;
  hasMore: boolean;
};

export type IncidentDto = {
  id: string;
  tenantId?: string;
  code: string;
  title: string;
  description: string | null;
  category: string;
  severity: number;
  status: string;
  classification: number;
  commanderId: string | null;
  openedAt: string | null;
  closedAt: string | null;
  parentId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  commander?: UserSummary | null;
};

export type IncidentParticipantDto = {
  incidentId: string;
  userId: string;
  roleInIncident: string;
  joinedAt: string;
  leftAt: string | null;
  user?: UserSummary | null;
};

export type IncidentTimelineDto = {
  id: string;
  incidentId: string;
  tenantId?: string;
  ts: string;
  kind: string;
  actorId: string;
  payload: Record<string, unknown>;
};

export type IncidentSitrepDto = {
  id: string;
  incidentId: string;
  tenantId?: string;
  reporterId: string;
  severity: number | null;
  text: string;
  attachments: string[];
  location: {
    lat: number;
    lon: number;
  } | null;
  reportedAt: string;
  reporter?: UserSummary | null;
};

export type AvailableIncidentTransitionDto = {
  code: IncidentTransitionCode;
  label: string;
  requires: string[];
};

export type IncidentDirectorySort =
  (typeof INCIDENT_SORT_OPTIONS)[number]["value"];

export type IncidentDirectoryFilters = {
  q?: string;
  status?: string;
  category?: string;
  severity?: number;
  sort?: IncidentDirectorySort;
};

export const INCIDENT_TIMELINE_DEFAULT_LIMIT = 12;
export const INCIDENT_SITREP_DEFAULT_LIMIT = 8;

export type IncidentWorkspace = {
  source: "api" | "mock";
  incident: IncidentDto | null;
  incidents: IncidentDto[];
  participants: IncidentParticipantDto[];
  timeline: IncidentTimelineDto[];
  timelinePage: IncidentCursorPageDto;
  sitreps: IncidentSitrepDto[];
  sitrepPage: IncidentCursorPageDto;
  availableTransitions: AvailableIncidentTransitionDto[];
  availableUsers: UserSummary[];
  taskWorkspace: TaskWorkspace;
  refreshedAt: string;
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const API_TOKEN =
  process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

const EMPTY_CURSOR_PAGE: IncidentCursorPageDto = {
  nextCursor: null,
  prevCursor: null,
  limit: 0,
  hasMore: false,
};

async function fetchIncidentApi<T>(path: string): Promise<T> {
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

export function buildIncidentDirectoryQuery(
  filters: IncidentDirectoryFilters,
) {
  return buildQueryString({
    q: filters.q,
    status: filters.status,
    category: filters.category,
    severity: filters.severity,
    sort: filters.sort,
  });
}

function deriveIncidentFromSummary(
  summary: IncidentSummary,
  users: UserSummary[],
): IncidentDto {
  return {
    id: summary.id,
    code: summary.code,
    title: summary.title,
    description: null,
    category: "other",
    severity: summary.severity,
    status: summary.status,
    classification: 1,
    commanderId: summary.commanderId ?? null,
    openedAt: null,
    closedAt: null,
    parentId: null,
    metadata: {},
    createdBy: summary.commanderId ?? "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    commander:
      users.find((user) => user.id === summary.commanderId) ?? null,
  };
}

function deriveParticipants(
  incident: IncidentDto | null,
  taskWorkspace: TaskWorkspace,
) {
  if (!incident) {
    return [];
  }

  const uniqueUsers = new Map<string, IncidentParticipantDto>();
  const joinedAt = new Date().toISOString();

  for (const user of taskWorkspace.visibleUsers) {
    const role =
      user.id === incident.commanderId
        ? "commander"
        : user.id === taskWorkspace.selectedTask?.assigneeId
          ? "responder"
          : "observer";

    uniqueUsers.set(user.id, {
      incidentId: incident.id,
      userId: user.id,
      roleInIncident: role,
      joinedAt,
      leftAt: null,
      user,
    });
  }

  return Array.from(uniqueUsers.values());
}

function uniqueUsers(items: Array<UserSummary | null | undefined>) {
  const registry = new Map<string, UserSummary>();

  for (const item of items) {
    if (item && !registry.has(item.id)) {
      registry.set(item.id, item);
    }
  }

  return Array.from(registry.values()).sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
}

function deriveAvailableUsers(
  participants: IncidentParticipantDto[],
  taskWorkspace: TaskWorkspace,
  incident: IncidentDto | null,
) {
  return uniqueUsers([
    ...participants.map((participant) => participant.user ?? null),
    ...taskWorkspace.visibleUsers,
    incident?.commander ?? null,
  ]);
}

function filterMockIncidents(
  incidents: IncidentDto[],
  options?: IncidentDirectoryFilters,
) {
  const search = options?.q?.trim().toLowerCase();

  const filtered = incidents.filter((incident) => {
    if (options?.status && incident.status !== options.status) {
      return false;
    }
    if (options?.category && incident.category !== options.category) {
      return false;
    }
    if (options?.severity && incident.severity !== options.severity) {
      return false;
    }
    if (search) {
      const haystack = `${incident.code} ${incident.title} ${incident.description ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }

    return true;
  });

  return sortIncidents(filtered, options?.sort);
}

function sortIncidents(
  incidents: IncidentDto[],
  sort: IncidentDirectorySort = "newest",
) {
  const items = [...incidents];

  items.sort((left, right) => {
    switch (sort) {
      case "updated": {
        return (
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      }
      case "severity_desc": {
        if (right.severity !== left.severity) {
          return right.severity - left.severity;
        }
        return (
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      }
      case "severity_asc": {
        if (left.severity !== right.severity) {
          return left.severity - right.severity;
        }
        return (
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      }
      case "code_asc": {
        return left.code.localeCompare(right.code);
      }
      case "newest":
      default: {
        return (
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        );
      }
    }
  });

  return items;
}

async function loadDirectoryUsers(taskWorkspace: TaskWorkspace) {
  try {
    const usersResponse = await fetchIncidentApi<
      | Array<{ id: string; fullName: string; email?: string | null }>
      | { data: Array<{ id: string; fullName: string; email?: string | null }> }
    >("/users");
    const rows = Array.isArray(usersResponse) ? usersResponse : usersResponse.data;

    return uniqueUsers([
      ...rows.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email ?? null,
      })),
      ...taskWorkspace.visibleUsers,
    ]);
  } catch {
    return taskWorkspace.visibleUsers;
  }
}

export async function loadIncidentDirectory(
  options?: IncidentDirectoryFilters,
): Promise<IncidentWorkspace> {
  const refreshedAt = new Date().toISOString();
  const query = buildQueryString({
    q: options?.q,
    status: options?.status,
    category: options?.category,
    severity: options?.severity,
    sort: options?.sort,
    limit: 36,
  });

  try {
    const [incidentsResponse, taskWorkspace] = await Promise.all([
      fetchIncidentApi<{ data: IncidentDto[] }>(`/incidents${query}`),
      loadTaskWorkspace(),
    ]);
    const availableUsers = await loadDirectoryUsers(taskWorkspace);

    return {
      source: "api",
      incident: null,
      incidents: sortIncidents(incidentsResponse.data, options?.sort),
      participants: [],
      timeline: [],
      timelinePage: EMPTY_CURSOR_PAGE,
      sitreps: [],
      sitrepPage: EMPTY_CURSOR_PAGE,
      availableTransitions: [],
      availableUsers,
      taskWorkspace,
      refreshedAt,
    };
  } catch {
    const taskWorkspace = await loadTaskWorkspace();
    const incidents = filterMockIncidents(
      taskWorkspace.visibleIncidents.map((incident) =>
        deriveIncidentFromSummary(incident, taskWorkspace.visibleUsers),
      ),
      options,
    );

    return {
      source: "mock",
      incident: null,
      incidents,
      participants: [],
      timeline: [],
      timelinePage: EMPTY_CURSOR_PAGE,
      sitreps: [],
      sitrepPage: EMPTY_CURSOR_PAGE,
      availableTransitions: [],
      availableUsers: taskWorkspace.visibleUsers,
      taskWorkspace,
      refreshedAt,
    };
  }
}

export async function loadIncidentWorkspace(options: {
  incidentId: string;
  taskId?: string;
}): Promise<IncidentWorkspace> {
  const refreshedAt = new Date().toISOString();
  const taskWorkspace = await loadTaskWorkspace({
    incidentId: options.incidentId,
    taskId: options.taskId,
  });

  try {
    const [
      incidentResponse,
      participantsResponse,
      timelineResponse,
      sitrepsResponse,
      incidentsResponse,
      transitionsResponse,
    ] = await Promise.all([
      fetchIncidentApi<{ data: IncidentDto }>(`/incidents/${options.incidentId}`),
      fetchIncidentApi<{ data: IncidentParticipantDto[] }>(
        `/incidents/${options.incidentId}/participants`,
      ),
      fetchIncidentApi<{ data: IncidentTimelineDto[]; page: IncidentCursorPageDto }>(
        `/incidents/${options.incidentId}/timeline?limit=${INCIDENT_TIMELINE_DEFAULT_LIMIT}`,
      ),
      fetchIncidentApi<{ data: IncidentSitrepDto[]; page: IncidentCursorPageDto }>(
        `/incidents/${options.incidentId}/sitreps?limit=${INCIDENT_SITREP_DEFAULT_LIMIT}`,
      ),
      fetchIncidentApi<{ data: IncidentDto[] }>("/incidents?limit=24"),
      fetchIncidentApi<{ data: AvailableIncidentTransitionDto[] }>(
        `/incidents/${options.incidentId}/transitions/available`,
      ),
    ]);

    let tenantUsers: UserSummary[] = [];

    try {
      const usersResponse = await fetchIncidentApi<{ id: string; fullName: string; email?: string | null }[] | { data: Array<{ id: string; fullName: string; email?: string | null }> }>("/users");
      const rows = Array.isArray(usersResponse)
        ? usersResponse
        : usersResponse.data;
      tenantUsers = rows.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email ?? null,
      }));
    } catch {
      tenantUsers = [];
    }
    const availableUsers = uniqueUsers([
      ...tenantUsers,
      ...deriveAvailableUsers(
        participantsResponse.data,
        taskWorkspace,
        incidentResponse.data,
      ),
    ]);

    return {
      source: "api",
      incident: incidentResponse.data,
      incidents: incidentsResponse.data,
      participants: participantsResponse.data,
      timeline: timelineResponse.data,
      timelinePage: timelineResponse.page,
      sitreps: sitrepsResponse.data,
      sitrepPage: sitrepsResponse.page,
      availableTransitions: transitionsResponse.data,
      availableUsers,
      taskWorkspace,
      refreshedAt,
    };
  } catch {
    const incidentSummary =
      taskWorkspace.visibleIncidents.find(
        (item) => item.id === options.incidentId,
      ) ?? taskWorkspace.highlightedIncident;

    const incident = incidentSummary
      ? deriveIncidentFromSummary(incidentSummary, taskWorkspace.visibleUsers)
      : null;

    return {
      source: "mock",
      incident,
      incidents: taskWorkspace.visibleIncidents.map((item) =>
        deriveIncidentFromSummary(item, taskWorkspace.visibleUsers),
      ),
      participants: deriveParticipants(incident, taskWorkspace),
      timeline: [],
      timelinePage: EMPTY_CURSOR_PAGE,
      sitreps: [],
      sitrepPage: EMPTY_CURSOR_PAGE,
      availableTransitions: [],
      availableUsers: deriveAvailableUsers(
        deriveParticipants(incident, taskWorkspace),
        taskWorkspace,
        incident,
      ),
      taskWorkspace,
      refreshedAt,
    };
  }
}

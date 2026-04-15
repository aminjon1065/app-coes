import { endOfDay, format, startOfDay, subDays } from "date-fns";

export type AuditEventDto = {
  id: string;
  ts: string;
  tenantId: string;
  actorId: string | null;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
};

export type AuditCursorPageDto = {
  nextCursor: string | null;
  limit: number;
  hasMore: boolean;
};

export type AuditWorkspace = {
  source: "api" | "mock";
  events: AuditEventDto[];
  page: AuditCursorPageDto;
  filters: {
    actorId?: string;
    eventType?: string;
    targetType?: string;
    targetId?: string;
    from: string;
    to: string;
  };
  refreshedAt: string;
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const API_TOKEN =
  process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

const DEFAULT_LIMIT = 30;

const MOCK_EVENTS: AuditEventDto[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    ts: "2026-04-15T08:24:00.000Z",
    tenantId: "tenant-1",
    actorId: "2f6fdc08-9f0b-4f38-b154-df4ec5bf6c7a",
    eventType: "incident.status_changed.v1",
    targetType: "incident",
    targetId: "28df6635-c728-4d97-8d45-11ca49d8f091",
    before: { status: "open" },
    after: { status: "contained", reason: "Perimeter stabilized" },
    ip: "10.14.2.44",
    userAgent: "Mozilla/5.0 CoES/CommandDesk",
    sessionId: "54a244fd-8cbb-45e7-89d2-07482f35ce1f",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    ts: "2026-04-15T08:02:00.000Z",
    tenantId: "tenant-1",
    actorId: "580466f4-77ae-41ca-a594-f76422e1df3d",
    eventType: "task.status_changed.v1",
    targetType: "task",
    targetId: "7db5cc2f-d080-4c2f-a9fc-6070f3e365fa",
    before: { status: "in_progress" },
    after: { status: "review", comment: "Package ready for approval" },
    ip: "10.14.2.61",
    userAgent: "Mozilla/5.0 CoES/TaskBoard",
    sessionId: "38be7f11-2f4a-4d1c-94f3-0b4d5b93ef62",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    ts: "2026-04-15T07:37:00.000Z",
    tenantId: "tenant-1",
    actorId: null,
    eventType: "iam.login.failed.v1",
    targetType: "user",
    targetId: "3b01fcf1-2a7e-43ec-b80d-a302e89f2163",
    before: null,
    after: { reason: "invalid_password", email: "liaison@agency.local" },
    ip: "172.20.1.15",
    userAgent: "Mozilla/5.0 Firefox/124.0",
    sessionId: null,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    ts: "2026-04-15T06:55:00.000Z",
    tenantId: "tenant-1",
    actorId: "2f6fdc08-9f0b-4f38-b154-df4ec5bf6c7a",
    eventType: "iam.breakglass.activated.v1",
    targetType: "user",
    targetId: "49172e0f-b65a-440d-b4f8-0bb8bd2d4e08",
    before: { role: "shift_lead" },
    after: {
      role: "platform_admin",
      reason: "Regional failover during outage",
      expiresAt: "2026-04-15T10:55:00.000Z",
    },
    ip: "10.14.2.44",
    userAgent: "Mozilla/5.0 CoES/Admin",
    sessionId: "226ca98f-ea85-4470-a93d-4c23638c8818",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    ts: "2026-04-15T06:12:00.000Z",
    tenantId: "tenant-1",
    actorId: "580466f4-77ae-41ca-a594-f76422e1df3d",
    eventType: "document.approved.v1",
    targetType: "document",
    targetId: "a79f8774-757d-45c3-ae40-2a589ceddd26",
    before: { lifecycleState: "REVIEW" },
    after: { lifecycleState: "APPROVED", version: 3 },
    ip: "10.14.2.61",
    userAgent: "Mozilla/5.0 CoES/Documents",
    sessionId: "71707ae9-daa5-4e82-a9dd-21efe40d6394",
  },
];

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

function normalizeRange(from?: string, to?: string) {
  const resolvedTo = to ? new Date(to) : new Date();
  const resolvedFrom = from ? new Date(from) : subDays(resolvedTo, 13);

  return {
    from: startOfDay(resolvedFrom).toISOString(),
    to: endOfDay(resolvedTo).toISOString(),
  };
}

function filterMockEvents(
  events: AuditEventDto[],
  filters: {
    actorId?: string;
    eventType?: string;
    targetType?: string;
    targetId?: string;
    from: string;
    to: string;
  },
) {
  return events.filter((event) => {
    if (filters.actorId && event.actorId !== filters.actorId) {
      return false;
    }
    if (filters.eventType && !event.eventType.includes(filters.eventType)) {
      return false;
    }
    if (filters.targetType && event.targetType !== filters.targetType) {
      return false;
    }
    if (filters.targetId && event.targetId !== filters.targetId) {
      return false;
    }

    const ts = new Date(event.ts).getTime();
    return ts >= new Date(filters.from).getTime() && ts <= new Date(filters.to).getTime();
  });
}

export async function loadAuditWorkspace(options?: {
  actorId?: string;
  eventType?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<AuditWorkspace> {
  const range = normalizeRange(options?.from, options?.to);
  const filters = {
    actorId: options?.actorId,
    eventType: options?.eventType,
    targetType: options?.targetType,
    targetId: options?.targetId,
    from: range.from,
    to: range.to,
  };
  const query = buildQueryString({
    ...filters,
    limit: options?.limit ?? DEFAULT_LIMIT,
  });

  try {
    const response = await fetchApi<{
      data: AuditEventDto[];
      page: AuditCursorPageDto;
    }>(`/audit${query}`);

    return {
      source: "api",
      events: response.data,
      page: response.page,
      filters,
      refreshedAt: new Date().toISOString(),
    };
  } catch {
    const filtered = filterMockEvents(MOCK_EVENTS, filters).sort((left, right) =>
      right.ts.localeCompare(left.ts),
    );
    const limit = options?.limit ?? DEFAULT_LIMIT;

    return {
      source: "mock",
      events: filtered.slice(0, limit),
      page: {
        nextCursor: null,
        limit,
        hasMore: false,
      },
      filters,
      refreshedAt: new Date().toISOString(),
    };
  }
}

export function formatAuditTimestamp(value: string) {
  return format(new Date(value), "dd MMM yyyy, HH:mm:ss");
}

export function summarizeAuditTarget(event: AuditEventDto) {
  if (!event.targetType) {
    return "System";
  }

  return event.targetId
    ? `${event.targetType} / ${event.targetId.slice(0, 8)}...`
    : event.targetType;
}


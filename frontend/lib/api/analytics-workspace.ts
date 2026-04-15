import {
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfDay,
  format,
  parseISO,
  startOfDay,
  subDays,
} from "date-fns";

export type AnalyticsSummaryDto = {
  openIncidents: number;
  closedIncidents: number;
  avgResolutionMinutes: number;
  tasksTotal: number;
  tasksDone: number;
  tasksBreachedSla: number;
  participantsTotal: number;
  sitrepsTotal: number;
  overdueTasks: number;
};

export type IncidentVolumePoint = {
  bucket: string;
  count: number;
};

export type TaskThroughputPoint = {
  status: string;
  count: number;
  avgTimeToStartMinutes: number;
  avgTimeToCompleteMinutes: number;
};

export type SlaComplianceDto = {
  total: number;
  breached: number;
  compliant: number;
  compliancePct: number;
};

export type CategoryBreakdownPoint = {
  category: string;
  count: number;
  severityPeak: number;
  avgResolutionMinutes: number;
};

export type AnalyticsWorkspace = {
  source: "api" | "mock";
  from: string;
  to: string;
  groupBy: "day" | "week" | "month";
  summary: AnalyticsSummaryDto;
  volume: IncidentVolumePoint[];
  throughput: TaskThroughputPoint[];
  sla: SlaComplianceDto;
  categories: CategoryBreakdownPoint[];
  refreshedAt: string;
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const API_TOKEN =
  process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

const MOCK_BASE_DATE = new Date("2026-04-15T09:00:00.000Z");

const mockSummary: AnalyticsSummaryDto = {
  openIncidents: 8,
  closedIncidents: 21,
  avgResolutionMinutes: 412,
  tasksTotal: 368,
  tasksDone: 287,
  tasksBreachedSla: 24,
  participantsTotal: 94,
  sitrepsTotal: 73,
  overdueTasks: 11,
};

const mockThroughput: TaskThroughputPoint[] = [
  { status: "done", count: 287, avgTimeToStartMinutes: 26, avgTimeToCompleteMinutes: 213 },
  { status: "review", count: 22, avgTimeToStartMinutes: 19, avgTimeToCompleteMinutes: 154 },
  { status: "in_progress", count: 31, avgTimeToStartMinutes: 14, avgTimeToCompleteMinutes: 0 },
  { status: "blocked", count: 18, avgTimeToStartMinutes: 32, avgTimeToCompleteMinutes: 0 },
  { status: "cancelled", count: 10, avgTimeToStartMinutes: 0, avgTimeToCompleteMinutes: 47 },
];

const mockCategories: CategoryBreakdownPoint[] = [
  { category: "flood", count: 11, severityPeak: 5, avgResolutionMinutes: 530 },
  { category: "wildfire", count: 7, severityPeak: 4, avgResolutionMinutes: 620 },
  { category: "landslide", count: 4, severityPeak: 4, avgResolutionMinutes: 345 },
  { category: "storm", count: 5, severityPeak: 3, avgResolutionMinutes: 288 },
  { category: "earthquake", count: 2, severityPeak: 5, avgResolutionMinutes: 910 },
];

async function fetchApi<T>(path: string): Promise<T> {
  const headers: HeadersInit = { Accept: "application/json" };

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
  const resolvedTo = to ? parseISO(to) : MOCK_BASE_DATE;
  const resolvedFrom = from ? parseISO(from) : subDays(resolvedTo, 29);

  return {
    from: startOfDay(resolvedFrom).toISOString(),
    to: endOfDay(resolvedTo).toISOString(),
  };
}

function buildMockVolume(
  from: string,
  to: string,
  groupBy: "day" | "week" | "month",
): IncidentVolumePoint[] {
  const interval = { start: parseISO(from), end: parseISO(to) };
  const buckets =
    groupBy === "month"
      ? eachMonthOfInterval(interval)
      : groupBy === "week"
        ? eachWeekOfInterval(interval, { weekStartsOn: 1 })
        : eachDayOfInterval(interval);

  return buckets.map((bucket, index) => ({
    bucket: bucket.toISOString(),
    count:
      groupBy === "month"
        ? 4 + ((index * 3) % 7)
        : groupBy === "week"
          ? 2 + ((index * 5) % 6)
          : 1 + ((index * 7 + 3) % 5),
  }));
}

function buildMockWorkspace(options?: {
  from?: string;
  to?: string;
  groupBy?: "day" | "week" | "month";
}): AnalyticsWorkspace {
  const range = normalizeRange(options?.from, options?.to);
  const groupBy = options?.groupBy ?? "day";
  const compliant = mockSummary.tasksTotal - mockSummary.tasksBreachedSla;
  const total = mockSummary.tasksTotal;

  return {
    source: "mock",
    from: range.from,
    to: range.to,
    groupBy,
    summary: mockSummary,
    volume: buildMockVolume(range.from, range.to, groupBy),
    throughput: mockThroughput,
    sla: {
      total,
      breached: mockSummary.tasksBreachedSla,
      compliant,
      compliancePct: total === 0 ? 100 : Number(((compliant / total) * 100).toFixed(2)),
    },
    categories: mockCategories,
    refreshedAt: new Date().toISOString(),
  };
}

export async function loadAnalyticsWorkspace(options?: {
  from?: string;
  to?: string;
  groupBy?: "day" | "week" | "month";
}): Promise<AnalyticsWorkspace> {
  const range = normalizeRange(options?.from, options?.to);
  const groupBy = options?.groupBy ?? "day";
  const rangeQuery = buildQueryString({ from: range.from, to: range.to });
  const volumeQuery = buildQueryString({
    from: range.from,
    to: range.to,
    groupBy,
  });

  try {
    const [summaryResponse, volumeResponse, throughputResponse, slaResponse, categoryResponse] =
      await Promise.all([
        fetchApi<{ data: AnalyticsSummaryDto }>(`/analytics/summary${rangeQuery}`),
        fetchApi<{ data: IncidentVolumePoint[] }>(`/analytics/incident-volume${volumeQuery}`),
        fetchApi<{ data: TaskThroughputPoint[] }>(`/analytics/task-throughput${rangeQuery}`),
        fetchApi<{ data: SlaComplianceDto }>(`/analytics/sla-compliance${rangeQuery}`),
        fetchApi<{ data: CategoryBreakdownPoint[] }>(`/analytics/by-category${rangeQuery}`),
      ]);

    return {
      source: "api",
      from: range.from,
      to: range.to,
      groupBy,
      summary: summaryResponse.data,
      volume: volumeResponse.data,
      throughput: throughputResponse.data,
      sla: {
        ...slaResponse.data,
        compliancePct: Number(slaResponse.data.compliancePct),
      },
      categories: categoryResponse.data,
      refreshedAt: new Date().toISOString(),
    };
  } catch {
    return buildMockWorkspace(options);
  }
}

export function formatAnalyticsRangeLabel(from: string, to: string) {
  return `${format(parseISO(from), "dd MMM")} - ${format(parseISO(to), "dd MMM yyyy")}`;
}

export function formatMinutes(value: number) {
  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

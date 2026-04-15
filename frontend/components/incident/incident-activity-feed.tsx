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
import {
  describeRealtimeEvent,
  type FrontendRealtimeEvent,
} from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  formatTaskRelative,
  type UserSummary,
} from "@/lib/api/task-workspace";
import {
  INCIDENT_SITREP_DEFAULT_LIMIT,
  INCIDENT_TIMELINE_DEFAULT_LIMIT,
  type IncidentCursorPageDto,
  type IncidentParticipantDto,
  type IncidentSitrepDto,
  type IncidentTimelineDto,
} from "@/lib/api/incident-workspace";
import { IncidentTimeline } from "@/components/incident/incident-timeline";
import { SitrepCard } from "@/components/incident/sitrep-card";

type IncidentActivityFeedProps = {
  source: "api" | "mock";
  incidentId: string;
  timeline: IncidentTimelineDto[];
  timelinePage: IncidentCursorPageDto;
  sitreps: IncidentSitrepDto[];
  sitrepPage: IncidentCursorPageDto;
  users: UserSummary[];
  participants: IncidentParticipantDto[];
  refreshedAt: string;
};

type IncidentActivityResponse = {
  timeline: {
    data: IncidentTimelineDto[];
    page: IncidentCursorPageDto;
  } | null;
  sitreps: {
    data: IncidentSitrepDto[];
    page: IncidentCursorPageDto;
  } | null;
  fetchedAt: string;
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

async function requestIncidentActivity(options: {
  incidentId: string;
  includeTimeline?: boolean;
  includeSitreps?: boolean;
  timelineCursor?: string | null;
  sitrepCursor?: string | null;
  timelineLimit?: number;
  sitrepLimit?: number;
}) {
  const searchParams = new URLSearchParams();

  if (options.includeTimeline !== undefined) {
    searchParams.set("includeTimeline", options.includeTimeline ? "1" : "0");
  }
  if (options.includeSitreps !== undefined) {
    searchParams.set("includeSitreps", options.includeSitreps ? "1" : "0");
  }
  if (options.timelineCursor) {
    searchParams.set("timelineCursor", options.timelineCursor);
  }
  if (options.sitrepCursor) {
    searchParams.set("sitrepCursor", options.sitrepCursor);
  }
  if (options.timelineLimit) {
    searchParams.set("timelineLimit", String(options.timelineLimit));
  }
  if (options.sitrepLimit) {
    searchParams.set("sitrepLimit", String(options.sitrepLimit));
  }

  const response = await fetch(
    `/api/incidents/${options.incidentId}/activity?${searchParams.toString()}`,
    {
      cache: "no-store",
    },
  );
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, response.status));
  }

  return body as IncidentActivityResponse;
}

function mergeByDate<T extends { id: string }>(
  current: T[],
  incoming: T[],
  getTimestamp: (item: T) => string,
) {
  const registry = new Map<string, T>();

  for (const item of current) {
    registry.set(item.id, item);
  }
  for (const item of incoming) {
    registry.set(item.id, item);
  }

  return Array.from(registry.values()).sort((left, right) => {
    const delta =
      new Date(getTimestamp(right)).getTime() -
      new Date(getTimestamp(left)).getTime();

    if (delta !== 0) {
      return delta;
    }

    return right.id.localeCompare(left.id);
  });
}

function mergeTimeline(
  current: IncidentTimelineDto[],
  incoming: IncidentTimelineDto[],
) {
  return mergeByDate(current, incoming, (item) => item.ts);
}

function mergeSitreps(
  current: IncidentSitrepDto[],
  incoming: IncidentSitrepDto[],
) {
  return mergeByDate(current, incoming, (item) => item.reportedAt);
}

export function IncidentActivityFeed({
  source,
  incidentId,
  timeline: initialTimeline,
  timelinePage,
  sitreps: initialSitreps,
  sitrepPage,
  users,
  participants,
  refreshedAt,
}: IncidentActivityFeedProps) {
  const [timeline, setTimeline] = useState(initialTimeline);
  const [timelineNextCursor, setTimelineNextCursor] = useState(
    timelinePage.nextCursor,
  );
  const [timelineHasMore, setTimelineHasMore] = useState(timelinePage.hasMore);
  const [sitreps, setSitreps] = useState(initialSitreps);
  const [sitrepNextCursor, setSitrepNextCursor] = useState(sitrepPage.nextCursor);
  const [sitrepHasMore, setSitrepHasMore] = useState(sitrepPage.hasMore);
  const [lastSyncedAt, setLastSyncedAt] = useState(refreshedAt);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [isLoadingOlderTimeline, setIsLoadingOlderTimeline] = useState(false);
  const [isLoadingOlderSitreps, setIsLoadingOlderSitreps] = useState(false);
  const refreshInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const participantCount = participants.length;
  const canRefresh = source === "api";

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
      const payload = await requestIncidentActivity({
        incidentId,
        timelineLimit: INCIDENT_TIMELINE_DEFAULT_LIMIT,
        sitrepLimit: INCIDENT_SITREP_DEFAULT_LIMIT,
      });
      const latestTimeline = payload.timeline;
      const latestSitreps = payload.sitreps;

      startTransition(() => {
        if (latestTimeline) {
          setTimeline((current) => mergeTimeline(current, latestTimeline.data));
          setTimelineNextCursor(latestTimeline.page.nextCursor);
          setTimelineHasMore(latestTimeline.page.hasMore);
        }
        if (latestSitreps) {
          setSitreps((current) => mergeSitreps(current, latestSitreps.data));
          setSitrepNextCursor(latestSitreps.page.nextCursor);
          setSitrepHasMore(latestSitreps.page.hasMore);
        }
        setLastSyncedAt(payload.fetchedAt);
        setError(null);
        setStreamState("live");
      });
    } catch (refreshError) {
      setStreamState("offline");
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Activity refresh failed unexpectedly.",
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
    const copy = describeRealtimeEvent(event);
    toast(copy.title, {
      id: `${event.event}:${event.incidentId ?? "incident"}:${event.emittedAt ?? Date.now()}`,
      description: copy.description,
    });
  });

  useEffect(() => {
    if (!canRefresh) {
      return;
    }

    setStreamState("connecting");
    const eventSource = new EventSource(`/api/incidents/${incidentId}/stream`);

    eventSource.onopen = () => {
      setStreamState("live");
      setError(null);
    };

    eventSource.onerror = () => {
      setStreamState("offline");
      setError("Live incident stream disconnected. Waiting for automatic reconnect.");
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
    };
  }, [canRefresh, incidentId]);

  async function loadOlderTimeline() {
    if (!canRefresh || !timelineNextCursor || isLoadingOlderTimeline) {
      return;
    }

    setIsLoadingOlderTimeline(true);

    try {
      const payload = await requestIncidentActivity({
        incidentId,
        includeSitreps: false,
        timelineCursor: timelineNextCursor,
        timelineLimit: timelinePage.limit || INCIDENT_TIMELINE_DEFAULT_LIMIT,
      });

      if (!payload.timeline) {
        return;
      }
      const olderTimeline = payload.timeline;

      startTransition(() => {
        setTimeline((current) => mergeTimeline(current, olderTimeline.data));
        setTimelineNextCursor(olderTimeline.page.nextCursor);
        setTimelineHasMore(olderTimeline.page.hasMore);
        setLastSyncedAt(payload.fetchedAt);
        setError(null);
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Timeline pagination failed unexpectedly.",
      );
    } finally {
      setIsLoadingOlderTimeline(false);
    }
  }

  async function loadOlderSitreps() {
    if (!canRefresh || !sitrepNextCursor || isLoadingOlderSitreps) {
      return;
    }

    setIsLoadingOlderSitreps(true);

    try {
      const payload = await requestIncidentActivity({
        incidentId,
        includeTimeline: false,
        sitrepCursor: sitrepNextCursor,
        sitrepLimit: sitrepPage.limit || INCIDENT_SITREP_DEFAULT_LIMIT,
      });

      if (!payload.sitreps) {
        return;
      }
      const olderSitreps = payload.sitreps;

      startTransition(() => {
        setSitreps((current) => mergeSitreps(current, olderSitreps.data));
        setSitrepNextCursor(olderSitreps.page.nextCursor);
        setSitrepHasMore(olderSitreps.page.hasMore);
        setLastSyncedAt(payload.fetchedAt);
        setError(null);
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Sitrep pagination failed unexpectedly.",
      );
    } finally {
      setIsLoadingOlderSitreps(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-[rgba(12,16,26,0.88)] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
              Activity stream
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {canRefresh
                ? "Timeline and sitreps now refresh from a live event stream instead of timer polling."
                : "Activity feed is running in mock fallback mode and stays read-only."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
              {canRefresh
                ? `${streamState === "live" ? "Live stream" : streamState === "connecting" ? "Connecting..." : "Reconnecting..."} · synced ${formatTaskRelative(lastSyncedAt)}`
                : "Mock feed"}
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

      <section className="rounded-[30px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              Recent sitreps
            </p>
            <h2 className="mt-2 text-2xl font-medium text-white">
              Field reporting stream
            </h2>
          </div>
          <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-100">
            {sitreps.length}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {sitreps.length > 0 ? (
            sitreps.map((sitrep) => (
              <SitrepCard
                key={sitrep.id}
                sitrep={sitrep}
                users={users}
              />
            ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
              No situation reports in the current feed.
            </div>
          )}
        </div>

        {canRefresh && sitrepHasMore ? (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => void loadOlderSitreps()}
              disabled={isLoadingOlderSitreps}
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingOlderSitreps ? "Loading older sitreps..." : "Load older sitreps"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-[30px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              Timeline
            </p>
            <h2 className="mt-2 text-2xl font-medium text-white">
              Readable incident activity feed
            </h2>
          </div>
          <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
            {timeline.length} events · {participantCount} active participants
          </div>
        </div>

        <div className="mt-5">
          {timeline.length > 0 ? (
            <IncidentTimeline
              entries={timeline}
              sitreps={sitreps}
              users={users}
            />
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
              Timeline is empty in the current feed.
            </div>
          )}
        </div>

        {canRefresh && timelineHasMore ? (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => void loadOlderTimeline()}
              disabled={isLoadingOlderTimeline}
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingOlderTimeline
                ? "Loading older events..."
                : "Load older events"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

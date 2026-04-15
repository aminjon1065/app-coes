"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Search, X } from "lucide-react";
import {
  formatAuditTimestamp,
  type AuditCursorPageDto,
  type AuditEventDto,
  summarizeAuditTarget,
} from "@/lib/api/audit-workspace";
import { AuditEventDetail } from "@/components/audit/audit-event-detail";
import { cn } from "@/lib/utils";

type AuditLogTableProps = {
  source: "api" | "mock";
  initialEvents: AuditEventDto[];
  initialPage: AuditCursorPageDto;
  filters: {
    actorId?: string;
    eventType?: string;
    targetType?: string;
    targetId?: string;
    from: string;
    to: string;
  };
};

type AuditListResponse = {
  data: AuditEventDto[];
  page: AuditCursorPageDto;
};

function mergeEvents(current: AuditEventDto[], incoming: AuditEventDto[]) {
  const registry = new Map<string, AuditEventDto>();

  for (const event of current) {
    registry.set(event.id, event);
  }
  for (const event of incoming) {
    registry.set(event.id, event);
  }

  return Array.from(registry.values()).sort((left, right) => right.ts.localeCompare(left.ts));
}

function eventBadgeTone(eventType: string) {
  if (eventType.includes("breakglass") || eventType.includes("failed")) {
    return "border-rose-400/25 bg-rose-400/10 text-rose-50";
  }
  if (eventType.includes("approved") || eventType.includes("done")) {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-50";
  }
  if (eventType.includes("status_changed")) {
    return "border-amber-300/25 bg-amber-300/10 text-amber-50";
  }
  return "border-cyan-300/25 bg-cyan-300/10 text-cyan-50";
}

export function AuditLogTable({
  source,
  initialEvents,
  initialPage,
  filters,
}: AuditLogTableProps) {
  const [events, setEvents] = useState(initialEvents);
  const [page, setPage] = useState(initialPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AuditEventDto | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const canLoadMore = source === "api" && page.hasMore && Boolean(page.nextCursor);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }

    params.set("limit", String(page.limit || 30));
    return params;
  }, [filters, page.limit]);

  useEffect(() => {
    setEvents(initialEvents);
    setPage(initialPage);
  }, [initialEvents, initialPage]);

  const handleLoadMore = useEffectEvent(async () => {
    await loadMore();
  });

  useEffect(() => {
    if (!canLoadMore || !sentinelRef.current) {
      return;
    }

    const sentinel = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void handleLoadMore();
        }
      },
      { rootMargin: "220px" },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [canLoadMore, queryString, page.nextCursor, isLoadingMore]);

  async function loadMore() {
    if (!canLoadMore || isLoadingMore || !page.nextCursor) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const params = new URLSearchParams(queryString.toString());
      params.set("cursor", page.nextCursor);
      const response = await fetch(`/api/audit?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as AuditListResponse | { message: string };

      if (!response.ok || !("data" in payload)) {
        throw new Error(
          "message" in payload ? payload.message : "Audit pagination failed.",
        );
      }

      startTransition(() => {
        setEvents((current) => mergeEvents(current, payload.data));
        setPage(payload.page);
      });
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function openDetail(event: AuditEventDto) {
    setDetailOpen(true);
    setSelectedEvent(event);

    if (source !== "api") {
      return;
    }

    setIsDetailLoading(true);

    try {
      const response = await fetch(`/api/audit/${event.id}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | { data: AuditEventDto }
        | { message: string };

      if (!response.ok || !("data" in payload)) {
        throw new Error(
          "message" in payload ? payload.message : "Audit detail request failed.",
        );
      }

      setSelectedEvent(payload.data);
    } finally {
      setIsDetailLoading(false);
    }
  }

  return (
    <>
      <section className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
              Audit register
            </p>
            <h2 className="mt-2 text-2xl font-medium text-white">
              Append-only event stream
            </h2>
          </div>
          <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
            {events.length} events loaded
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                <th className="px-4 py-2">Timestamp</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Event Type</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2">IP</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length > 0 ? (
                events.map((event) => (
                  <tr
                    key={event.id}
                    className="rounded-[20px] border border-white/10 bg-black/15 text-sm text-slate-200"
                  >
                    <td className="rounded-l-[20px] px-4 py-3 align-top">
                      {formatAuditTimestamp(event.ts)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-xs text-slate-300">
                        {event.actorId ?? "system"}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          eventBadgeTone(event.eventType),
                        )}
                      >
                        {event.eventType}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-300">
                      {summarizeAuditTarget(event)}
                    </td>
                    <td className="px-4 py-3 align-top text-slate-400">
                      {event.ip ?? "—"}
                    </td>
                    <td className="rounded-r-[20px] px-4 py-3 text-right align-top">
                      <button
                        type="button"
                        onClick={() => void openDetail(event)}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-50 transition hover:bg-cyan-300/16"
                      >
                        <Search className="h-3.5 w-3.5" />
                        View detail
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    No audit events matched the current filter set.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canLoadMore ? (
          <div ref={sentinelRef} className="mt-4 flex justify-center py-4">
            <div className="inline-flex items-center gap-2 text-sm text-slate-400">
              {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isLoadingMore ? "Loading more events..." : "Scroll to load more"}
            </div>
          </div>
        ) : null}
      </section>

      <Dialog.Root open={detailOpen} onOpenChange={setDetailOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(960px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[32px] border border-white/10 bg-[rgba(10,16,28,0.96)] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.42)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-2xl font-medium text-white">
                  Audit event detail
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-slate-400">
                  Before/after payload inspection for the selected audit record.
                </Dialog.Description>
              </div>

              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-6">
              {isDetailLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading detail...
                </div>
              ) : selectedEvent ? (
                <AuditEventDetail event={selectedEvent} />
              ) : (
                <div className="text-sm text-slate-500">No event selected.</div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

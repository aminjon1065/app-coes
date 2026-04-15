"use client";

import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChatMessage } from "@/lib/api/chat-workspace";
import { MessageBubble } from "@/components/chat/message-bubble";

type MessageListItem =
  | { type: "date"; key: string; label: string }
  | { type: "message"; key: string; message: ChatMessage; grouped: boolean };

function dayKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
}

function dayLabel(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(date);
}

function buildItems(messages: ChatMessage[]): MessageListItem[] {
  const items: MessageListItem[] = [];
  let previous: ChatMessage | null = null;
  let previousDay: string | null = null;

  for (const message of messages) {
    const currentDay = dayKey(message.createdAt);

    if (currentDay !== previousDay) {
      items.push({
        type: "date",
        key: `date-${currentDay}`,
        label: dayLabel(message.createdAt),
      });
      previousDay = currentDay;
    }

    const grouped =
      Boolean(previous) &&
      previous?.senderId === message.senderId &&
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <=
        2 * 60_000;

    items.push({
      type: "message",
      key: message.id,
      message,
      grouped,
    });
    previous = message;
  }

  return items;
}

export function MessageList({
  messages,
  highlightedMessageIds,
  compact = false,
}: {
  messages: ChatMessage[];
  highlightedMessageIds: string[];
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const items = useMemo(() => buildItems(messages), [messages]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (items[index]?.type === "date" ? 44 : 112),
    overscan: 8,
  });

  useEffect(() => {
    const node = scrollRef.current;

    if (!node || !shouldAutoScrollRef.current) {
      return;
    }

    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-black/10 px-6 text-center text-sm leading-6 text-slate-500">
        No messages in this room yet. Send the first operational update.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        shouldAutoScrollRef.current =
          node.scrollHeight - node.scrollTop - node.clientHeight < 120;
      }}
      className={compact ? "max-h-[520px] overflow-y-auto pr-2" : "h-[620px] overflow-y-auto pr-2"}
    >
      <div
        className="relative"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];

          if (!item) {
            return null;
          }

          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {item.type === "date" ? (
                <div className="my-4 flex justify-center">
                  <span className="rounded-full border border-white/10 bg-slate-950/90 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-500 backdrop-blur">
                    {item.label}
                  </span>
                </div>
              ) : (
                <MessageBubble
                  message={item.message}
                  grouped={item.grouped}
                  highlighted={highlightedMessageIds.includes(item.message.id)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

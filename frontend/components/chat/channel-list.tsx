"use client";

import Link from "next/link";
import { Hash, RadioTower } from "lucide-react";
import type { ChatChannel } from "@/lib/api/chat-workspace";
import { channelDisplayName, formatChatTimestamp } from "@/lib/api/chat-workspace";
import { cn } from "@/lib/utils";

export function ChannelList({
  channels,
  activeChannelId,
  unreadCounts,
  basePath = "/chat",
  compact = false,
}: {
  channels: ChatChannel[];
  activeChannelId: string | null;
  unreadCounts: Record<string, number>;
  basePath?: string;
  compact?: boolean;
}) {
  if (channels.length === 0) {
    return (
      <div className="rounded-[26px] border border-dashed border-white/10 bg-black/10 p-5 text-sm leading-6 text-slate-500">
        No accessible chat channels.
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {channels.map((channel) => {
        const active = channel.id === activeChannelId;
        const unread = unreadCounts[channel.id] ?? channel.unreadCount ?? 0;
        const href = `${basePath}${basePath.includes("?") ? "&" : "?"}channelId=${channel.id}`;

        return (
          <Link
            key={channel.id}
            href={href}
            className={cn(
              "block rounded-[24px] border p-4 transition",
              active
                ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-50"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/8",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border",
                    active
                      ? "border-cyan-300/30 bg-cyan-300/12"
                      : "border-white/10 bg-black/12",
                  )}
                >
                  {channel.type === "INCIDENT_ROOM" ? (
                    <RadioTower className="h-4 w-4" />
                  ) : (
                    <Hash className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {channelDisplayName(channel)}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {channel.latestMessage?.content ??
                      channel.description ??
                      `${channel.memberCount} members`}
                  </div>
                </div>
              </div>
              {unread > 0 ? (
                <span className="rounded-full border border-amber-300/30 bg-amber-300/12 px-2 py-0.5 text-xs text-amber-100">
                  {unread}
                </span>
              ) : null}
            </div>
            <div className="mt-3 text-[11px] uppercase tracking-[0.2em] text-slate-600">
              Updated {formatChatTimestamp(channel.updatedAt)}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

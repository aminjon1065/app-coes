"use client";

import type { ChatMessage } from "@/lib/api/chat-workspace";
import { formatChatTimestamp } from "@/lib/api/chat-workspace";
import { cn } from "@/lib/utils";

export function MessageBubble({
  message,
  grouped,
  highlighted,
}: {
  message: ChatMessage;
  grouped: boolean;
  highlighted: boolean;
}) {
  const author =
    message.sender?.fullName ??
    message.sender?.displayName ??
    message.sender?.email ??
    message.senderId;
  const reactionGroups = new Map<string, number>();

  for (const reaction of message.reactions ?? []) {
    reactionGroups.set(reaction.emoji, (reactionGroups.get(reaction.emoji) ?? 0) + 1);
  }

  return (
    <article
      className={cn(
        "rounded-[24px] border px-4 py-3 transition",
        grouped ? "mt-2" : "mt-4",
        highlighted
          ? "border-cyan-300/45 bg-cyan-300/12 shadow-[0_0_40px_rgba(103,232,249,0.12)]"
          : "border-white/10 bg-black/14",
      )}
    >
      {!grouped ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-white">{author}</div>
          <time className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {formatChatTimestamp(message.createdAt)}
          </time>
        </div>
      ) : null}

      {message.redactedAt ? (
        <p className="text-sm italic leading-6 text-slate-500">
          Message redacted
          {message.redactReason ? `: ${message.redactReason}` : "."}
        </p>
      ) : (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
              {message.content}
            </p>
          ) : null}
          {message.fileId ? (
            <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
              Attachment linked: {message.fileId}
            </div>
          ) : null}
        </div>
      )}

      {reactionGroups.size > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {[...reactionGroups.entries()].map(([emoji, count]) => (
            <span
              key={emoji}
              className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-xs text-slate-200"
            >
              {emoji} {count}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

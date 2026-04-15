"use client";

import { cn } from "@/lib/utils";

export function TypingIndicator({
  userIds,
  className,
}: {
  userIds: string[];
  className?: string;
}) {
  if (userIds.length === 0) {
    return null;
  }

  const label =
    userIds.length === 1
      ? `${userIds[0]} is typing`
      : `${userIds.length} operators are typing`;

  return (
    <div className={cn("flex items-center gap-2 text-xs text-cyan-100/80", className)}>
      <span>{label}</span>
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200 [animation-delay:240ms]" />
      </span>
    </div>
  );
}

import { chatChannels } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Hash, Users, ArrowRight } from "lucide-react";

export function CommActivity() {
  return (
    <div className="flex flex-col bg-sentinel-card border border-sentinel-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sentinel-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-sentinel-text">Channels</h2>
          <span className="text-2xs font-bold px-1.5 py-0.5 rounded-sm bg-sentinel-primary/20 text-sentinel-primary">
            23
          </span>
        </div>
        <a
          href="/chat"
          className="flex items-center gap-1 text-xs text-sentinel-primary hover:text-sentinel-text transition-colors"
        >
          Open chat <ArrowRight className="w-3 h-3" />
        </a>
      </div>

      {/* Channels list */}
      <div className="flex-1 divide-y divide-sentinel-border overflow-y-auto">
        {chatChannels.map((channel) => (
          <div
            key={channel.id}
            className="flex flex-col gap-1 px-4 py-3 hover:bg-sentinel-border/40 transition-colors cursor-pointer"
          >
            {/* Top row */}
            <div className="flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-sentinel-subtle shrink-0" />
              <span className="flex-1 text-xs font-medium text-sentinel-text font-mono truncate">
                {channel.name}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {channel.unread > 0 && (
                  <span className="text-2xs font-bold px-1.5 py-0.5 rounded-sm bg-sentinel-primary text-white min-w-[20px] text-center">
                    {channel.unread}
                  </span>
                )}
                <span className="text-2xs font-mono text-sentinel-subtle">{channel.lastActivity}</span>
              </div>
            </div>

            {/* Last message */}
            <p className="text-xs text-sentinel-muted truncate ml-5 leading-tight">
              {channel.lastMessage}
            </p>

            {/* Bottom: members */}
            <div className="flex items-center gap-1 ml-5">
              <Users className="w-2.5 h-2.5 text-sentinel-subtle" />
              <span className="text-2xs text-sentinel-subtle">{channel.members} members</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

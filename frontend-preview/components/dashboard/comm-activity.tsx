import { chatChannels } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Hash, Users, ArrowRight } from "lucide-react";

export function CommActivity() {
  return (
    <div className="flex flex-col bg-coescd-card border border-coescd-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-coescd-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-coescd-text">Channels</h2>
          <span className="text-2xs font-bold px-1.5 py-0.5 rounded-sm bg-coescd-primary/20 text-coescd-primary">
            23
          </span>
        </div>
        <a
          href="/chat"
          className="flex items-center gap-1 text-xs text-coescd-primary hover:text-coescd-text transition-colors"
        >
          Open chat <ArrowRight className="w-3 h-3" />
        </a>
      </div>

      {/* Channels list */}
      <div className="flex-1 divide-y divide-coescd-border overflow-y-auto">
        {chatChannels.map((channel) => (
          <div
            key={channel.id}
            className="flex flex-col gap-1 px-4 py-3 hover:bg-coescd-border/40 transition-colors cursor-pointer"
          >
            {/* Top row */}
            <div className="flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-coescd-subtle shrink-0" />
              <span className="flex-1 text-xs font-medium text-coescd-text font-mono truncate">
                {channel.name}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {channel.unread > 0 && (
                  <span className="text-2xs font-bold px-1.5 py-0.5 rounded-sm bg-coescd-primary text-white min-w-[20px] text-center">
                    {channel.unread}
                  </span>
                )}
                <span className="text-2xs font-mono text-coescd-subtle">{channel.lastActivity}</span>
              </div>
            </div>

            {/* Last message */}
            <p className="text-xs text-coescd-muted truncate ml-5 leading-tight">
              {channel.lastMessage}
            </p>

            {/* Bottom: members */}
            <div className="flex items-center gap-1 ml-5">
              <Users className="w-2.5 h-2.5 text-coescd-subtle" />
              <span className="text-2xs text-coescd-subtle">{channel.members} members</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquareText, RadioTower, Wifi, WifiOff } from "lucide-react";
import { ChannelList } from "@/components/chat/channel-list";
import { MessageComposer } from "@/components/chat/message-composer";
import { MessageList } from "@/components/chat/message-list";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { createChatSocket, type ChatSocket } from "@/lib/chat-socket";
import {
  channelDisplayName,
  type ChatWorkspace,
  participantDisplayName,
} from "@/lib/api/chat-workspace";
import type { IncidentParticipantDto } from "@/lib/api/incident-workspace";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";

export function ChatWorkspaceShell({
  initialWorkspace,
  participants = [],
  compact = false,
  basePath = "/chat",
}: {
  initialWorkspace: ChatWorkspace;
  participants?: IncidentParticipantDto[];
  compact?: boolean;
  basePath?: string;
}) {
  const [socket] = useState<ChatSocket | null>(() =>
    createChatSocket({
      socketUrl: initialWorkspace.socketUrl,
      token: initialWorkspace.socketToken,
    }),
  );
  const [connected, setConnected] = useState(false);
  const [eventNotice, setEventNotice] = useState<string | null>(null);
  const {
    channels,
    messages,
    unreadCounts,
    typingUsers,
    activeChannelId,
    highlightedMessageIds,
    setInitialState,
    appendMessage,
    replaceMessage,
    setMessageReactions,
    setTyping,
    markRead,
  } = useChatStore();

  useEffect(() => {
    setInitialState({
      channels: initialWorkspace.channels,
      activeChannelId: initialWorkspace.activeChannel?.id ?? null,
      messages: initialWorkspace.messages,
    });
  }, [initialWorkspace, setInitialState]);

  useEffect(() => {
    const client = socket;

    if (!client) {
      return;
    }

    client.on("connect", () => {
      setConnected(true);
      if (initialWorkspace.activeChannel?.id) {
        client.emit("join_channel", initialWorkspace.activeChannel.id);
      }
    });
    client.on("disconnect", () => setConnected(false));
    client.on("message.new", (message) => {
      appendMessage(message, true);
      setEventNotice("New chat message received.");
    });
    client.on("message.redacted", (message) => {
      replaceMessage(message);
      setEventNotice("A chat message was redacted.");
    });
    client.on("message.reactions", (payload) => {
      setMessageReactions(payload.channelId, payload.messageId, payload.reactions);
    });
    client.on("typing.start", (payload) => {
      setTyping(payload.channelId, payload.userId, true);
    });
    client.on("typing.stop", (payload) => {
      setTyping(payload.channelId, payload.userId, false);
    });

    return () => {
      client.disconnect();
    };
  }, [
    appendMessage,
    initialWorkspace.activeChannel?.id,
    replaceMessage,
    setMessageReactions,
    setTyping,
    socket,
  ]);

  useEffect(() => {
    if (!activeChannelId || !socket) {
      return;
    }

    socket.emit("join_channel", activeChannelId);
    markRead(activeChannelId);
  }, [activeChannelId, markRead, socket]);

  useEffect(() => {
    if (!eventNotice) {
      return;
    }

    const timeout = setTimeout(() => setEventNotice(null), 3000);
    return () => clearTimeout(timeout);
  }, [eventNotice]);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels],
  );
  const activeMessages = activeChannelId ? messages[activeChannelId] ?? [] : [];
  const activeTypingUsers = activeChannelId
    ? (typingUsers[activeChannelId] ?? []).map((item) => item.userId)
    : [];

  return (
    <section
      className={cn(
        "grid gap-6",
        compact ? "xl:grid-cols-[0.72fr_1.28fr]" : "xl:grid-cols-[360px_1fr]",
      )}
    >
      <aside className="space-y-4">
        <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
                Chat channels
              </p>
              <h2 className="mt-2 text-xl font-medium text-white">
                Live coordination
              </h2>
            </div>
            <div
              className={cn(
                "rounded-2xl border p-2",
                connected
                  ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                  : "border-white/10 bg-black/14 text-slate-500",
              )}
            >
              {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {initialWorkspace.source === "api"
              ? "Socket transport joins active channels and applies incoming messages in-place."
              : "Fallback mode: configure backend API auth to enable live chat writes."}
          </p>
        </div>

        <ChannelList
          channels={channels}
          activeChannelId={activeChannelId}
          unreadCounts={unreadCounts}
          basePath={basePath}
          compact={compact}
        />

        {participants.length > 0 ? (
          <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              Participants
            </p>
            <div className="mt-4 space-y-2">
              {participants.slice(0, compact ? 5 : 8).map((participant) => (
                <div
                  key={`${participant.incidentId}-${participant.userId}`}
                  className="rounded-2xl border border-white/10 bg-black/12 px-3 py-2"
                >
                  <div className="truncate text-sm font-medium text-white">
                    {participantDisplayName(participant)}
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    {participant.roleInIncident}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.22)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 text-cyan-100">
              {activeChannel?.type === "INCIDENT_ROOM" ? (
                <RadioTower className="h-5 w-5" />
              ) : (
                <MessageSquareText className="h-5 w-5" />
              )}
              <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
                Active room
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-medium text-white">
              {activeChannel ? channelDisplayName(activeChannel) : "No channel selected"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {activeChannel?.description ??
                (activeChannel ? `${activeChannel.memberCount} members` : "Select a channel to open message history.")}
            </p>
          </div>
          {eventNotice ? (
            <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-50">
              {eventNotice}
            </div>
          ) : null}
        </div>

        <div className="mt-5">
          <MessageList
            messages={activeMessages}
            highlightedMessageIds={highlightedMessageIds}
            compact={compact}
          />
        </div>

        <TypingIndicator userIds={activeTypingUsers} className="mt-4" />

        <div className="mt-4">
          <MessageComposer
            channelId={activeChannelId}
            socket={socket}
            disabled={initialWorkspace.source !== "api"}
            compact={compact}
          />
        </div>
      </div>
    </section>
  );
}

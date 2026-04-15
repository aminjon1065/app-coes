"use client";

import { io, type Socket } from "socket.io-client";
import type { ChatMessage, ChatReaction } from "@/lib/api/chat-workspace";

export type ChatSocket = Socket<
  {
    "message.new": (message: ChatMessage) => void;
    "message.redacted": (message: ChatMessage) => void;
    "message.reactions": (payload: {
      channelId: string;
      messageId: string;
      reactions: ChatReaction[];
    }) => void;
    "typing.start": (payload: { channelId: string; userId: string }) => void;
    "typing.stop": (payload: { channelId: string; userId: string }) => void;
  },
  {
    join_channel: (channelId: string) => void;
    typing_start: (channelId: string) => void;
    typing_stop: (channelId: string) => void;
  }
>;

export function createChatSocket({
  socketUrl,
  token,
}: {
  socketUrl: string;
  token: string | null;
}): ChatSocket | null {
  if (!token) {
    return null;
  }

  return io(`${socketUrl}/chat`, {
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true,
  }) as ChatSocket;
}

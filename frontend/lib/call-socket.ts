"use client";

import { io, type Socket } from "socket.io-client";
import type { CallSessionState } from "@/lib/api/call-workspace";

export type CallSocket = Socket<
  {
    "call.state": (session: CallSessionState) => void;
    "call.participant_joined": (payload: { callId: string; userId: string }) => void;
    "call.participant_left": (payload: { callId: string; userId: string }) => void;
    "call.signal": (payload: {
      callId: string;
      fromUserId: string;
      type: "offer" | "answer" | "ice-candidate" | "hangup";
      data: unknown;
    }) => void;
    "call.ended": (payload: { callId: string }) => void;
  },
  {
    "call.join": (payload: { callId: string }) => void;
    "call.leave": (payload: { callId: string }) => void;
    "call.signal": (payload: {
      callId: string;
      targetUserId?: string;
      type: "offer" | "answer" | "ice-candidate" | "hangup";
      data: unknown;
    }) => void;
    "call.toggle": (payload: {
      callId: string;
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      screenEnabled?: boolean;
    }) => void;
  }
>;

export function createCallSocket({
  socketUrl,
  token,
}: {
  socketUrl: string;
  token: string | null;
}): CallSocket | null {
  if (!token) {
    return null;
  }

  return io(`${socketUrl}/call`, {
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true,
  }) as CallSocket;
}

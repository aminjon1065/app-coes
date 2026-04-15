"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createCallSocket, type CallSocket } from "@/lib/call-socket";
import type { CallParticipantState, CallSessionState } from "@/lib/api/call-workspace";

type RemoteParticipant = CallParticipantState & {
  stream: MediaStream | null;
};

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function useWebRtcCall({
  socketUrl,
  token,
  currentUserId,
}: {
  socketUrl: string;
  token: string | null;
  currentUserId: string | null;
}) {
  const [socket] = useState<CallSocket | null>(() =>
    createCallSocket({ socketUrl, token }),
  );
  const [activeCall, setActiveCall] = useState<CallSessionState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [connected, setConnected] = useState(false);
  const activeCallRef = useRef<CallSessionState | null>(null);
  const currentUserIdRef = useRef<string | null>(currentUserId);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const remoteStreamsRef = useRef(new Map<string, MediaStream>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const localParticipant = useMemo(
    () =>
      activeCall?.participants.find(
        (participant) => participant.userId === currentUserId,
      ) ?? null,
    [activeCall, currentUserId],
  );

  const syncRemoteParticipants = useCallback((session: CallSessionState) => {
    const localUserId = currentUserIdRef.current;
    const next = session.participants
      .filter((participant) => participant.userId !== localUserId)
      .map((participant) => ({
        ...participant,
        stream: remoteStreamsRef.current.get(participant.userId) ?? null,
      }));

    setRemoteParticipants(next);

    const allowed = new Set(next.map((participant) => participant.userId));
    for (const [userId, connection] of peerConnectionsRef.current.entries()) {
      if (!allowed.has(userId)) {
        connection.close();
        peerConnectionsRef.current.delete(userId);
        remoteStreamsRef.current.delete(userId);
      }
    }
  }, []);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localStreamRef.current = stream;
    cameraVideoTrackRef.current = stream.getVideoTracks()[0] ?? null;
    setLocalStream(stream);
    return stream;
  }, []);

  const createPeerConnection = useCallback(async (remoteUserId: string) => {
    const existing = peerConnectionsRef.current.get(remoteUserId);
    if (existing) {
      return existing;
    }

    const stream = await ensureLocalStream();
    const connection = new RTCPeerConnection(RTC_CONFIGURATION);

    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }

    connection.onicecandidate = (event) => {
      const session = activeCallRef.current;

      if (!event.candidate || !session || !socket) {
        return;
      }

      socket.emit("call.signal", {
        callId: session.id,
        targetUserId: remoteUserId,
        type: "ice-candidate",
        data: event.candidate.toJSON(),
      });
    };

    connection.ontrack = (event) => {
      const streamFromEvent =
        event.streams[0] ??
        remoteStreamsRef.current.get(remoteUserId) ??
        new MediaStream();

      if (!event.streams[0]) {
        streamFromEvent.addTrack(event.track);
      }

      remoteStreamsRef.current.set(remoteUserId, streamFromEvent);
      setRemoteParticipants((current) =>
        current.map((participant) =>
          participant.userId === remoteUserId
            ? { ...participant, stream: streamFromEvent }
            : participant,
        ),
      );
    };

    connection.onconnectionstatechange = () => {
      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "closed" ||
        connection.connectionState === "disconnected"
      ) {
        connection.close();
        peerConnectionsRef.current.delete(remoteUserId);
        remoteStreamsRef.current.delete(remoteUserId);
        setRemoteParticipants((current) =>
          current.filter((participant) => participant.userId !== remoteUserId),
        );
      }
    };

    peerConnectionsRef.current.set(remoteUserId, connection);
    return connection;
  }, [ensureLocalStream, socket]);

  const createOfferForParticipant = useCallback(async (remoteUserId: string) => {
    const session = activeCallRef.current;

    if (!session || !socket) {
      return;
    }

    const connection = await createPeerConnection(remoteUserId);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);

    socket.emit("call.signal", {
      callId: session.id,
      targetUserId: remoteUserId,
      type: "offer",
      data: offer,
    });
  }, [createPeerConnection, socket]);

  const handleSignal = useCallback(
    async (payload: {
      callId: string;
      fromUserId: string;
      type: "offer" | "answer" | "ice-candidate" | "hangup";
      data: unknown;
    }) => {
      const session = activeCallRef.current;

      if (!session || payload.callId !== session.id || !socket) {
        return;
      }

      if (payload.type === "hangup") {
        const existing = peerConnectionsRef.current.get(payload.fromUserId);
        existing?.close();
        peerConnectionsRef.current.delete(payload.fromUserId);
        remoteStreamsRef.current.delete(payload.fromUserId);
        setRemoteParticipants((current) =>
          current.filter((participant) => participant.userId !== payload.fromUserId),
        );
        return;
      }

      const connection = await createPeerConnection(payload.fromUserId);

      if (payload.type === "offer") {
        await connection.setRemoteDescription(
          new RTCSessionDescription(payload.data as RTCSessionDescriptionInit),
        );
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.emit("call.signal", {
          callId: session.id,
          targetUserId: payload.fromUserId,
          type: "answer",
          data: answer,
        });
        return;
      }

      if (payload.type === "answer") {
        await connection.setRemoteDescription(
          new RTCSessionDescription(payload.data as RTCSessionDescriptionInit),
        );
        return;
      }

      if (payload.type === "ice-candidate" && payload.data) {
        await connection.addIceCandidate(
          new RTCIceCandidate(payload.data as RTCIceCandidateInit),
        );
      }
    },
    [createPeerConnection, socket],
  );

  const leaveCall = useCallback(async () => {
    const session = activeCallRef.current;

    if (session && socket) {
      socket.emit("call.leave", { callId: session.id });
      for (const [userId] of peerConnectionsRef.current.entries()) {
        socket.emit("call.signal", {
          callId: session.id,
          targetUserId: userId,
          type: "hangup",
          data: null,
        });
      }
    }

    for (const connection of peerConnectionsRef.current.values()) {
      connection.close();
    }
    peerConnectionsRef.current.clear();
    remoteStreamsRef.current.clear();
    setRemoteParticipants([]);

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
    }
    localStreamRef.current = null;
    cameraVideoTrackRef.current = null;
    screenTrackRef.current = null;
    setLocalStream(null);
    activeCallRef.current = null;
    setActiveCall(null);
  }, [socket]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("call.state", (session) => {
      setActiveCall(session);
      syncRemoteParticipants(session);
    });
    socket.on("call.participant_joined", (payload) => {
      const session = activeCallRef.current;

      if (!session || payload.callId !== session.id) {
        return;
      }
      if (payload.userId !== currentUserIdRef.current) {
        void createOfferForParticipant(payload.userId);
      }
    });
    socket.on("call.participant_left", (payload) => {
      const session = activeCallRef.current;

      if (!session || payload.callId !== session.id) {
        return;
      }
      const connection = peerConnectionsRef.current.get(payload.userId);
      connection?.close();
      peerConnectionsRef.current.delete(payload.userId);
      remoteStreamsRef.current.delete(payload.userId);
      setRemoteParticipants((current) =>
        current.filter((participant) => participant.userId !== payload.userId),
      );
    });
    socket.on("call.signal", (payload) => {
      void handleSignal(payload);
    });
    socket.on("call.ended", (payload) => {
      if (payload.callId === activeCallRef.current?.id) {
        void leaveCall();
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [createOfferForParticipant, handleSignal, leaveCall, socket, syncRemoteParticipants]);

  const joinCall = useCallback(async (session: CallSessionState) => {
    if (!socket || !currentUserIdRef.current) {
      return;
    }

    await ensureLocalStream();
    activeCallRef.current = session;
    setActiveCall(session);
    socket.emit("call.join", { callId: session.id });
  }, [ensureLocalStream, socket]);

  const toggleAudio = useCallback(async () => {
    const session = activeCallRef.current;

    if (!session || !localStreamRef.current || !socket) {
      return;
    }

    const nextEnabled = !(localParticipant?.audioEnabled ?? true);
    for (const track of localStreamRef.current.getAudioTracks()) {
      track.enabled = nextEnabled;
    }
    socket.emit("call.toggle", {
      callId: session.id,
      audioEnabled: nextEnabled,
    });
  }, [localParticipant, socket]);

  const toggleVideo = useCallback(async () => {
    const session = activeCallRef.current;

    if (!session || !localStreamRef.current || !socket) {
      return;
    }

    const nextEnabled = !(localParticipant?.videoEnabled ?? true);
    for (const track of localStreamRef.current.getVideoTracks()) {
      track.enabled = nextEnabled;
    }
    socket.emit("call.toggle", {
      callId: session.id,
      videoEnabled: nextEnabled,
    });
  }, [localParticipant, socket]);

  const stopScreenShare = useCallback(async () => {
    const session = activeCallRef.current;

    if (!session || !socket || !localStreamRef.current) {
      return;
    }

    if (!screenTrackRef.current) {
      return;
    }

    const cameraTrack = cameraVideoTrackRef.current;
    if (cameraTrack) {
      for (const connection of peerConnectionsRef.current.values()) {
        const sender = connection
          .getSenders()
          .find((item) => item.track?.kind === "video");
        await sender?.replaceTrack(cameraTrack);
      }
    }
    screenTrackRef.current.stop();
    screenTrackRef.current = null;
    socket.emit("call.toggle", {
      callId: session.id,
      screenEnabled: false,
      videoEnabled: true,
    });
    setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
  }, [socket]);

  const toggleScreenShare = useCallback(async () => {
    const session = activeCallRef.current;

    if (!session || !socket || !localStreamRef.current) {
      return;
    }

    if (screenTrackRef.current) {
      await stopScreenShare();
      return;
    }

    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    const screenTrack = displayStream.getVideoTracks()[0];
    if (!screenTrack) {
      return;
    }

    screenTrackRef.current = screenTrack;
    for (const connection of peerConnectionsRef.current.values()) {
      const sender = connection
        .getSenders()
        .find((item) => item.track?.kind === "video");
      await sender?.replaceTrack(screenTrack);
    }
    screenTrack.onended = () => {
      void stopScreenShare();
    };
    setLocalStream(
      new MediaStream([
        ...localStreamRef.current.getAudioTracks(),
        screenTrack,
      ]),
    );
    socket.emit("call.toggle", {
      callId: session.id,
      screenEnabled: true,
      videoEnabled: true,
    });
  }, [socket, stopScreenShare]);

  return {
    socketConnected: connected,
    activeCall,
    localParticipant,
    localStream,
    remoteParticipants,
    joinCall,
    leaveCall,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
  };
}

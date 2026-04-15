"use client";

import { PhoneCall } from "lucide-react";
import type { CallSessionState } from "@/lib/api/call-workspace";
import { ParticipantTile } from "@/components/call/participant-tile";
import { CallControls } from "@/components/call/call-controls";

type OverlayParticipant = {
  userId: string;
  label: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenEnabled: boolean;
  stream: MediaStream | null;
  isLocal?: boolean;
};

export function CallOverlay({
  call,
  localParticipant,
  remoteParticipants,
  onToggleAudio,
  onToggleVideo,
  onToggleScreen,
  onLeave,
}: {
  call: CallSessionState;
  localParticipant: OverlayParticipant | null;
  remoteParticipants: OverlayParticipant[];
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
}) {
  return (
    <section className="fixed bottom-24 right-4 z-50 w-[min(980px,calc(100vw-2rem))] rounded-[32px] border border-white/10 bg-[rgba(10,16,28,0.94)] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.42)] backdrop-blur-xl md:right-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-100">
            <PhoneCall className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
              Active call
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-medium text-white">
            {call.title ?? "Live coordination bridge"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {call.participants.length} participant{call.participants.length > 1 ? "s" : ""} in the room
          </p>
        </div>

        <CallControls
          audioEnabled={localParticipant?.audioEnabled ?? true}
          videoEnabled={localParticipant?.videoEnabled ?? true}
          screenEnabled={localParticipant?.screenEnabled ?? false}
          onToggleAudio={onToggleAudio}
          onToggleVideo={onToggleVideo}
          onToggleScreen={onToggleScreen}
          onLeave={onLeave}
        />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {localParticipant ? (
          <ParticipantTile
            key={`local-${localParticipant.userId}`}
            label={`${localParticipant.label} (You)`}
            stream={localParticipant.stream}
            isLocal
            audioEnabled={localParticipant.audioEnabled}
            videoEnabled={localParticipant.videoEnabled}
            screenEnabled={localParticipant.screenEnabled}
          />
        ) : null}
        {remoteParticipants.map((participant) => (
          <ParticipantTile
            key={participant.userId}
            label={participant.label}
            stream={participant.stream}
            audioEnabled={participant.audioEnabled}
            videoEnabled={participant.videoEnabled}
            screenEnabled={participant.screenEnabled}
          />
        ))}
      </div>
    </section>
  );
}

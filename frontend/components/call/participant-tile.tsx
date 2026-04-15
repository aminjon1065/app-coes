"use client";

import { useEffect, useRef } from "react";
import { Mic, MicOff, MonitorUp, Video, VideoOff } from "lucide-react";

type ParticipantTileProps = {
  label: string;
  stream: MediaStream | null;
  isLocal?: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenEnabled: boolean;
};

export function ParticipantTile({
  label,
  stream,
  isLocal = false,
  audioEnabled,
  videoEnabled,
  screenEnabled,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <article className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black/30">
      <div className="relative aspect-[4/3] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_48%),linear-gradient(180deg,rgba(10,16,28,0.92),rgba(4,8,15,0.98))]">
        {stream && videoEnabled ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Camera off
          </div>
        )}

        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-xs font-medium text-white">
            {label}
          </span>
          <span className="rounded-full border border-white/10 bg-black/45 px-2 py-1 text-xs text-slate-200">
            {audioEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
          </span>
          <span className="rounded-full border border-white/10 bg-black/45 px-2 py-1 text-xs text-slate-200">
            {videoEnabled ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
          </span>
          {screenEnabled ? (
            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-50">
              <MonitorUp className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

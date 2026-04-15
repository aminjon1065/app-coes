"use client";

import type { ReactNode } from "react";
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";

type CallControlsProps = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenEnabled: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
};

function ControlButton({
  active,
  label,
  onClick,
  icon,
  danger = false,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition",
        danger
          ? "border-rose-400/30 bg-rose-400/10 text-rose-50 hover:bg-rose-400/16"
          : active
            ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/16"
            : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function CallControls({
  audioEnabled,
  videoEnabled,
  screenEnabled,
  onToggleAudio,
  onToggleVideo,
  onToggleScreen,
  onLeave,
}: CallControlsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <ControlButton
        active={audioEnabled}
        onClick={onToggleAudio}
        label={audioEnabled ? "Mute" : "Unmute"}
        icon={audioEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      />
      <ControlButton
        active={videoEnabled}
        onClick={onToggleVideo}
        label={videoEnabled ? "Camera on" : "Camera off"}
        icon={videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      />
      <ControlButton
        active={screenEnabled}
        onClick={onToggleScreen}
        label={screenEnabled ? "Stop share" : "Share screen"}
        icon={<MonitorUp className="h-4 w-4" />}
      />
      <ControlButton
        active={false}
        onClick={onLeave}
        label="End call"
        icon={<PhoneOff className="h-4 w-4" />}
        danger
      />
    </div>
  );
}

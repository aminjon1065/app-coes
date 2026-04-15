"use client";

import { ChatWorkspaceShell } from "@/components/chat/chat-workspace-shell";
import type { ChatWorkspace } from "@/lib/api/chat-workspace";
import type { IncidentParticipantDto } from "@/lib/api/incident-workspace";

export function IncidentRoomPanel({
  incidentId,
  initialWorkspace,
  participants,
  compact = true,
}: {
  incidentId: string;
  initialWorkspace: ChatWorkspace;
  participants: IncidentParticipantDto[];
  compact?: boolean;
}) {
  return (
    <ChatWorkspaceShell
      initialWorkspace={initialWorkspace}
      participants={participants}
      compact={compact}
      basePath={`/incidents/${incidentId}?tab=chat`}
    />
  );
}

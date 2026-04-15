export type CallParticipantState = {
  userId: string;
  joinedAt: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenEnabled: boolean;
};

export type CallSessionState = {
  id: string;
  tenantId: string;
  channelId: string | null;
  incidentId: string | null;
  title: string | null;
  status: "active" | "ended";
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  participants: CallParticipantState[];
};

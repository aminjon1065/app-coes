import type { IncidentParticipantDto } from "@/lib/api/incident-workspace";

export type ChatChannelType = "DIRECT" | "GROUP" | "INCIDENT_ROOM" | "BROADCAST";

export type ChatUserSummary = {
  id: string;
  email?: string;
  fullName?: string;
  displayName?: string;
};

export type ChatReaction = {
  id?: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt?: string;
  user?: ChatUserSummary | null;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  senderId: string;
  content: string | null;
  kind: "TEXT" | "FILE" | "SYSTEM" | "SITREP" | "ESCALATION";
  parentId: string | null;
  fileId: string | null;
  redactedAt: string | null;
  redactedBy: string | null;
  redactReason: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  sender?: ChatUserSummary | null;
  reactions?: ChatReaction[];
};

export type ChatChannel = {
  id: string;
  tenantId?: string;
  incidentId: string | null;
  type: ChatChannelType;
  name: string | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  metadata: Record<string, unknown>;
  memberCount: number;
  unreadCount: number;
  latestMessage: ChatMessage | null;
};

export type ChatMessagePage = {
  nextCursor: string | null;
  limit: number;
};

export type ChatWorkspace = {
  source: "api" | "mock";
  channels: ChatChannel[];
  activeChannel: ChatChannel | null;
  messages: ChatMessage[];
  messagePage: ChatMessagePage;
  socketToken: string | null;
  socketUrl: string;
  refreshedAt: string;
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const API_TOKEN =
  process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

function getSocketUrl() {
  const explicit =
    process.env.COESCD_SOCKET_URL ?? process.env.NEXT_PUBLIC_COESCD_SOCKET_URL;

  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  return API_BASE_URL.replace(/\/api\/v\d+\/?$/, "").replace(/\/$/, "");
}

async function fetchChatApi<T>(path: string): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(2500),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function buildMockChannels(incidentId?: string | null): ChatChannel[] {
  const now = new Date().toISOString();

  return [
    {
      id: incidentId ? `mock-incident-room-${incidentId}` : "mock-command-room",
      incidentId: incidentId ?? null,
      type: incidentId ? "INCIDENT_ROOM" : "GROUP",
      name: incidentId ? "Incident room" : "Command room",
      description: "Mock chat fallback until the backend chat API is reachable.",
      createdBy: "mock-system",
      createdAt: now,
      updatedAt: now,
      metadata: {},
      memberCount: 4,
      unreadCount: 0,
      latestMessage: null,
    },
    {
      id: "mock-logistics",
      incidentId: null,
      type: "GROUP",
      name: "Logistics",
      description: "Supply and transport coordination.",
      createdBy: "mock-system",
      createdAt: now,
      updatedAt: now,
      metadata: {},
      memberCount: 3,
      unreadCount: 1,
      latestMessage: null,
    },
  ];
}

function buildMockMessages(channelId: string): ChatMessage[] {
  const now = Date.now();

  return [
    {
      id: `${channelId}-mock-1`,
      channelId,
      senderId: "mock-lead",
      content: "Incident chat is ready. Live backend connection will replace this fallback feed.",
      kind: "SYSTEM",
      parentId: null,
      fileId: null,
      redactedAt: null,
      redactedBy: null,
      redactReason: null,
      createdAt: new Date(now - 12 * 60_000).toISOString(),
      updatedAt: new Date(now - 12 * 60_000).toISOString(),
      metadata: {},
      sender: { id: "mock-lead", fullName: "Command Lead" },
      reactions: [],
    },
    {
      id: `${channelId}-mock-2`,
      channelId,
      senderId: "mock-ops",
      content: "Use the composer once the API token and chat service are configured.",
      kind: "TEXT",
      parentId: null,
      fileId: null,
      redactedAt: null,
      redactedBy: null,
      redactReason: null,
      createdAt: new Date(now - 4 * 60_000).toISOString(),
      updatedAt: new Date(now - 4 * 60_000).toISOString(),
      metadata: {},
      sender: { id: "mock-ops", fullName: "Operations" },
      reactions: [],
    },
  ];
}

function mockWorkspace(incidentId?: string | null, channelId?: string | null): ChatWorkspace {
  const channels = buildMockChannels(incidentId);
  const activeChannel =
    channels.find((channel) => channel.id === channelId) ??
    channels.find((channel) => channel.incidentId === incidentId && channel.type === "INCIDENT_ROOM") ??
    channels[0] ??
    null;

  return {
    source: "mock",
    channels,
    activeChannel,
    messages: activeChannel ? buildMockMessages(activeChannel.id) : [],
    messagePage: { nextCursor: null, limit: 0 },
    socketToken: null,
    socketUrl: getSocketUrl(),
    refreshedAt: new Date().toISOString(),
  };
}

export function channelDisplayName(channel: ChatChannel) {
  if (channel.name) {
    return channel.name;
  }

  if (channel.type === "INCIDENT_ROOM") {
    return "Incident room";
  }

  return channel.type.toLowerCase().replaceAll("_", " ");
}

export function formatChatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function participantDisplayName(participant: IncidentParticipantDto) {
  return participant.user?.fullName ?? participant.user?.email ?? participant.userId;
}

export async function loadChatWorkspace({
  channelId,
  incidentId,
}: {
  channelId?: string | null;
  incidentId?: string | null;
} = {}): Promise<ChatWorkspace> {
  try {
    const channelResponse = await fetchChatApi<{ data: ChatChannel[] }>("/channels");
    const channels = channelResponse.data;
    const activeChannel =
      (incidentId
        ? channels.find(
            (channel) =>
              channel.type === "INCIDENT_ROOM" && channel.incidentId === incidentId,
          )
        : null) ??
      (channelId ? channels.find((channel) => channel.id === channelId) : null) ??
      channels[0] ??
      null;

    const messageResponse = activeChannel
      ? await fetchChatApi<{ data: ChatMessage[]; page: ChatMessagePage }>(
          `/channels/${activeChannel.id}/messages?limit=80`,
        )
      : { data: [], page: { nextCursor: null, limit: 0 } };

    return {
      source: "api",
      channels,
      activeChannel,
      messages: messageResponse.data.slice().reverse(),
      messagePage: messageResponse.page,
      socketToken: API_TOKEN ?? null,
      socketUrl: getSocketUrl(),
      refreshedAt: new Date().toISOString(),
    };
  } catch {
    return mockWorkspace(incidentId, channelId);
  }
}

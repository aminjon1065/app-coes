export type SessionSecurityUser = {
  id: string;
  tenantId: string;
  roles: string[];
  permissions?: string[];
  clearance: number;
  sessionId: string;
  mfaEnabled: boolean;
};

export type SecurityWorkspace = {
  source: "api" | "mock";
  currentUser: SessionSecurityUser;
  refreshedAt: string;
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const API_TOKEN =
  process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

async function fetchSecurityApi<T>(path: string): Promise<T> {
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

function mockCurrentUser(): SessionSecurityUser {
  return {
    id: "mock-lead",
    tenantId: "tenant-1",
    roles: ["incident_commander"],
    permissions: ["iam.profile.read", "iam.profile.manage"],
    clearance: 3,
    sessionId: "mock-session",
    mfaEnabled: false,
  };
}

export async function loadSecurityWorkspace(): Promise<SecurityWorkspace> {
  try {
    const currentUser = await fetchSecurityApi<SessionSecurityUser>("/auth/me");

    return {
      source: "api",
      currentUser,
      refreshedAt: new Date().toISOString(),
    };
  } catch {
    return {
      source: "mock",
      currentUser: mockCurrentUser(),
      refreshedAt: new Date().toISOString(),
    };
  }
}

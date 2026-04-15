import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export type AdminCurrentUser = {
  id: string;
  tenantId: string;
  roles: string[];
  permissions?: string[];
  clearance: number;
  sessionId: string;
};

export type AdminUserDto = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  clearance: number;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AdminWorkspace = {
  source: "api" | "mock";
  currentUser: AdminCurrentUser;
  users: AdminUserDto[];
  refreshedAt: string;
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

async function parseResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorMessage(body: unknown, status: number) {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }

  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: string | string[] }).message;

    if (Array.isArray(message) && message.length > 0) {
      return message.join(", ");
    }

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return `Admin request failed with status ${status}.`;
}

async function adminApiRequest<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const headers = new Headers({
    Accept: "application/json",
  });
  const token =
    process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const serializedCookies = cookieStore.toString();

  if (serializedCookies) {
    headers.set("Cookie", serializedCookies);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(body, response.status));
  }

  return body as T;
}

function mockCurrentUser(): AdminCurrentUser {
  return {
    id: "user-admin-1",
    tenantId: "tenant-1",
    roles: ["tenant_admin"],
    permissions: ["iam.users.read", "iam.users.create", "iam.users.delete"],
    clearance: 4,
    sessionId: "session-admin-1",
  };
}

function mockUsers(): AdminUserDto[] {
  return [
    {
      id: "5d13fb1c-6af0-4cc4-b98a-6797e92013ad",
      email: "operator@coescd.local",
      fullName: "Rustam Nazarov",
      phone: "+992900000001",
      clearance: 4,
      status: "active",
      mfaEnabled: true,
      lastLoginAt: "2026-04-15T08:25:00.000Z",
      createdAt: "2026-04-01T06:00:00.000Z",
    },
    {
      id: "3f625381-88f2-4618-98b2-3d9d3f40d814",
      email: "liaison@coescd.local",
      fullName: "Dilafruz Safarova",
      phone: "+992900000002",
      clearance: 2,
      status: "active",
      mfaEnabled: false,
      lastLoginAt: "2026-04-14T17:10:00.000Z",
      createdAt: "2026-04-02T09:30:00.000Z",
    },
    {
      id: "cf8d6a48-5d8d-47fc-97d4-b58a771f86fa",
      email: "observer@coescd.local",
      fullName: "Bakhtiyor Akhmedov",
      phone: null,
      clearance: 1,
      status: "disabled",
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: "2026-04-03T12:10:00.000Z",
    },
  ];
}

export async function loadAdminWorkspace(): Promise<AdminWorkspace> {
  try {
    const [currentUser, users] = await Promise.all([
      adminApiRequest<AdminCurrentUser>("/auth/me"),
      adminApiRequest<AdminUserDto[]>("/users"),
    ]);

    return {
      source: "api",
      currentUser,
      users,
      refreshedAt: new Date().toISOString(),
    };
  } catch {
    return {
      source: "mock",
      currentUser: mockCurrentUser(),
      users: mockUsers(),
      refreshedAt: new Date().toISOString(),
    };
  }
}

export async function requireAdminAccess() {
  const workspace = await loadAdminWorkspace();
  const roles = new Set(workspace.currentUser.roles);
  const isAllowed =
    roles.has("platform_admin") ||
    roles.has("tenant_admin") ||
    roles.has("shift_lead");

  if (!isAllowed) {
    redirect("/dashboard");
  }

  return workspace;
}

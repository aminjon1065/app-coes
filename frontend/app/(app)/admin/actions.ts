"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

type AdminMutationStatus = "idle" | "success" | "error";

export type AdminMutationState = {
  status: AdminMutationStatus;
  message: string;
  redirectTo?: string;
  submissionId?: string;
};

export const INITIAL_ADMIN_MUTATION_STATE: AdminMutationState = {
  status: "idle",
  message: "",
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function requiredTrimmedString(formData: FormData, key: string, label: string) {
  const value = stringField(formData, key).trim();

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

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

function errorMessage(body: unknown, status: number) {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }

  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: string | string[] }).message;

    if (Array.isArray(message)) {
      return message.join(", ");
    }

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return `Admin request failed with status ${status}.`;
}

async function adminApiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

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
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(errorMessage(body, response.status));
  }

  return body as T;
}

function success(message: string): AdminMutationState {
  return {
    status: "success",
    message,
    submissionId: crypto.randomUUID(),
  };
}

function failure(error: unknown): AdminMutationState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Admin action failed unexpectedly.",
    submissionId: crypto.randomUUID(),
  };
}

function revalidateAdminViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/users");
}

export async function activateBreakGlassAction(
  _previousState: AdminMutationState,
  formData: FormData,
): Promise<AdminMutationState> {
  try {
    const targetUserId = requiredTrimmedString(formData, "targetUserId", "Target user");
    const roleCode = requiredTrimmedString(formData, "roleCode", "Temporary role");
    const reason = requiredTrimmedString(formData, "reason", "Reason");
    const durationHours = Number(stringField(formData, "durationHours") || "4");

    await adminApiRequest("/iam/break-glass", {
      method: "POST",
      body: JSON.stringify({
        targetUserId,
        roleCode,
        reason,
        durationHours,
      }),
    });

    revalidateAdminViews();
    return success("Break-glass access granted.");
  } catch (error) {
    return failure(error);
  }
}

export async function createAdminUserAction(
  _previousState: AdminMutationState,
  formData: FormData,
): Promise<AdminMutationState> {
  try {
    const email = requiredTrimmedString(formData, "email", "Email");
    const fullName = requiredTrimmedString(formData, "fullName", "Full name");
    const password = requiredTrimmedString(formData, "password", "Password");
    const phone = stringField(formData, "phone").trim() || undefined;
    const clearance = Number(stringField(formData, "clearance") || "1");

    await adminApiRequest("/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        fullName,
        password,
        phone,
        clearance,
      }),
    });

    revalidateAdminViews();
    return success("User created.");
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAdminUserAction(
  _previousState: AdminMutationState,
  formData: FormData,
): Promise<AdminMutationState> {
  try {
    const userId = requiredTrimmedString(formData, "userId", "User");

    await adminApiRequest(`/users/${userId}`, {
      method: "DELETE",
    });

    revalidateAdminViews();
    return success("User removed.");
  } catch (error) {
    return failure(error);
  }
}

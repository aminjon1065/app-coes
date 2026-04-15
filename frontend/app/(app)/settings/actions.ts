"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

type MutationStatus = "idle" | "success" | "error";

export type MfaEnrollMutationState = {
  status: MutationStatus;
  message: string;
  qrCodeDataUrl?: string;
  secret?: string;
  uri?: string;
  submissionId?: string;
};

export type MfaCodeMutationState = {
  status: MutationStatus;
  message: string;
  submissionId?: string;
};

export const INITIAL_MFA_ENROLL_MUTATION_STATE: MfaEnrollMutationState = {
  status: "idle",
  message: "",
};

export const INITIAL_MFA_CODE_MUTATION_STATE: MfaCodeMutationState = {
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

  return `Security request failed with status ${status}.`;
}

async function securityApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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

function successState(message: string): MfaCodeMutationState {
  return {
    status: "success",
    message,
    submissionId: crypto.randomUUID(),
  };
}

function failureState(error: unknown): MfaCodeMutationState {
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "Security action failed unexpectedly.",
    submissionId: crypto.randomUUID(),
  };
}

export async function enrollMfaAction(
  previousState: MfaEnrollMutationState,
  formData: FormData,
): Promise<MfaEnrollMutationState> {
  void previousState;
  void formData;
  try {
    const payload = await securityApiRequest<{
      secret: string;
      uri: string;
      qrCodeDataUrl: string;
    }>("/auth/mfa/enroll", {
      method: "POST",
    });

    return {
      status: "success",
      message: "Authenticator enrollment started. Scan the QR code and enter the 6-digit code below.",
      qrCodeDataUrl: payload.qrCodeDataUrl,
      secret: payload.secret,
      uri: payload.uri,
      submissionId: crypto.randomUUID(),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "MFA enrollment failed unexpectedly.",
      submissionId: crypto.randomUUID(),
    };
  }
}

export async function verifyMfaAction(
  _previousState: MfaCodeMutationState,
  formData: FormData,
): Promise<MfaCodeMutationState> {
  try {
    const code = requiredTrimmedString(formData, "code", "Verification code");

    await securityApiRequest("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    revalidatePath("/settings");
    return successState("Multi-factor authentication enabled.");
  } catch (error) {
    return failureState(error);
  }
}

export async function disableMfaAction(
  _previousState: MfaCodeMutationState,
  formData: FormData,
): Promise<MfaCodeMutationState> {
  try {
    const currentPassword = requiredTrimmedString(
      formData,
      "currentPassword",
      "Current password",
    );

    await securityApiRequest("/auth/mfa", {
      method: "DELETE",
      body: JSON.stringify({ currentPassword }),
    });

    revalidatePath("/settings");
    return successState("Multi-factor authentication disabled.");
  } catch (error) {
    return failureState(error);
  }
}

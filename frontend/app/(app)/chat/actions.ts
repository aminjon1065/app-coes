"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

type ChatMutationStatus = "idle" | "success" | "error";

export type ChatMutationState = {
  status: ChatMutationStatus;
  message: string;
  submissionId?: string;
};

export const INITIAL_CHAT_MUTATION_STATE: ChatMutationState = {
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

    if (Array.isArray(message)) {
      return message.join(", ");
    }

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return `Chat request failed with status ${status}.`;
}

async function chatApiRequest<T>(path: string, init: RequestInit): Promise<T> {
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
    signal: AbortSignal.timeout(5000),
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(body, response.status));
  }

  return body as T;
}

function successState(message: string): ChatMutationState {
  return {
    status: "success",
    message,
    submissionId: crypto.randomUUID(),
  };
}

function errorState(error: unknown): ChatMutationState {
  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "Chat action failed unexpectedly.",
    submissionId: crypto.randomUUID(),
  };
}

export async function sendChatMessageAction(
  _previousState: ChatMutationState,
  formData: FormData,
): Promise<ChatMutationState> {
  try {
    const channelId = stringField(formData, "channelId").trim();
    const content = stringField(formData, "content").trim();
    const fileId = stringField(formData, "fileId").trim();

    if (!channelId) {
      throw new Error("Channel is required.");
    }

    if (!content && !fileId) {
      throw new Error("Message text or attachment is required.");
    }

    await chatApiRequest(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: content || undefined,
        kind: fileId ? "FILE" : "TEXT",
        fileId: fileId || undefined,
      }),
    });

    revalidatePath("/chat");
    revalidatePath("/incidents");

    return successState("Message sent.");
  } catch (error) {
    return errorState(error);
  }
}

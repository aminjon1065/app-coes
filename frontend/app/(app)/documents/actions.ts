"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

type DocumentMutationStatus = "idle" | "success" | "error";

export type DocumentMutationState = {
  status: DocumentMutationStatus;
  message: string;
  redirectTo?: string;
  submissionId?: string;
};

export const INITIAL_DOCUMENT_MUTATION_STATE: DocumentMutationState = {
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

function optionalString(formData: FormData, key: string) {
  const value = stringField(formData, key).trim();
  return value || undefined;
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

  return `Document request failed with status ${status}.`;
}

async function documentApiRequest<T>(path: string, init: RequestInit): Promise<T> {
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

function success(message: string, redirectTo?: string): DocumentMutationState {
  return {
    status: "success",
    message,
    redirectTo,
    submissionId: crypto.randomUUID(),
  };
}

function failure(error: unknown): DocumentMutationState {
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "Document action failed unexpectedly.",
    submissionId: crypto.randomUUID(),
  };
}

function revalidateDocumentViews(documentId?: string) {
  revalidatePath("/documents");
  if (documentId) {
    revalidatePath(`/documents/${documentId}`);
  }
}

export async function createDocumentAction(
  _previousState: DocumentMutationState,
  formData: FormData,
): Promise<DocumentMutationState> {
  try {
    const title = stringField(formData, "title").trim();
    const templateCode = stringField(formData, "templateCode").trim();
    const incidentId = optionalString(formData, "incidentId");
    const classification = Number(stringField(formData, "classification") || "1");
    const templateVars: Record<string, string> = {};

    for (const [key, value] of formData.entries()) {
      if (key.startsWith("templateVars.") && typeof value === "string" && value.trim()) {
        templateVars[key.slice("templateVars.".length)] = value.trim();
      }
    }

    if (!title || !templateCode) {
      throw new Error("Title and template are required.");
    }

    const response = await documentApiRequest<{ data: { id: string } }>("/documents", {
      method: "POST",
      body: JSON.stringify({
        title,
        templateCode,
        incidentId,
        classification,
        templateVars,
      }),
    });

    revalidateDocumentViews(response.data.id);
    return success("Document created.", `/documents/${response.data.id}`);
  } catch (error) {
    return failure(error);
  }
}

async function lifecycleAction(
  endpoint: string,
  formData: FormData,
  message: string,
  includeComment = false,
) {
  const documentId = stringField(formData, "documentId").trim();
  const comment = optionalString(formData, "comment");

  if (!documentId) {
    throw new Error("Document id is required.");
  }

  await documentApiRequest(`/documents/${documentId}/${endpoint}`, {
    method: "POST",
    body: JSON.stringify(includeComment ? { comment } : {}),
  });
  revalidateDocumentViews(documentId);
  return success(message, `/documents/${documentId}`);
}

export async function submitDocumentReviewAction(
  _previousState: DocumentMutationState,
  formData: FormData,
): Promise<DocumentMutationState> {
  try {
    return await lifecycleAction("submit-review", formData, "Document submitted for review.");
  } catch (error) {
    return failure(error);
  }
}

export async function approveDocumentAction(
  _previousState: DocumentMutationState,
  formData: FormData,
): Promise<DocumentMutationState> {
  try {
    return await lifecycleAction("approve", formData, "Document approved.", true);
  } catch (error) {
    return failure(error);
  }
}

export async function rejectDocumentAction(
  _previousState: DocumentMutationState,
  formData: FormData,
): Promise<DocumentMutationState> {
  try {
    return await lifecycleAction("reject", formData, "Document rejected.", true);
  } catch (error) {
    return failure(error);
  }
}

export async function publishDocumentAction(
  _previousState: DocumentMutationState,
  formData: FormData,
): Promise<DocumentMutationState> {
  try {
    return await lifecycleAction("publish", formData, "Document published.");
  } catch (error) {
    return failure(error);
  }
}

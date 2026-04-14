"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

type IncidentMutationStatus = "idle" | "success" | "error";

export type IncidentMutationState = {
  status: IncidentMutationStatus;
  message: string;
  redirectTo?: string;
  submissionId?: string;
};

export const INITIAL_INCIDENT_MUTATION_STATE: IncidentMutationState = {
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

function optionalTrimmedString(formData: FormData, key: string) {
  const value = stringField(formData, key).trim();
  return value || null;
}

function optionalInt(formData: FormData, key: string) {
  const raw = stringField(formData, key).trim();

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${key} must be a whole number.`);
  }

  return parsed;
}

function resolveOptionalEntityId(
  formData: FormData,
  key: string,
  manualKey: string,
) {
  const selected = stringField(formData, key).trim();

  if (!selected) {
    return null;
  }

  if (selected === "__manual__") {
    return requiredTrimmedString(formData, manualKey, manualKey);
  }

  return selected;
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

  if (body && typeof body === "object") {
    const message =
      "message" in body
        ? (body as { message?: string | string[] }).message
        : undefined;

    if (Array.isArray(message) && message.length > 0) {
      return message.join(", ");
    }

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }

    const error =
      "error" in body ? (body as { error?: string }).error : undefined;

    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
  }

  return `Request failed with status ${status}.`;
}

async function incidentApiRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const cookieStore = await cookies();
  const requestHeaders = new Headers(init.headers);
  requestHeaders.set("Accept", "application/json");

  if (init.body && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const token =
    process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  const serializedCookies = cookieStore.toString();

  if (serializedCookies) {
    requestHeaders.set("Cookie", serializedCookies);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: requestHeaders,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(body, response.status));
  }

  return body as T;
}

function successState(message: string, redirectTo: string): IncidentMutationState {
  return {
    status: "success",
    message,
    redirectTo,
    submissionId: crypto.randomUUID(),
  };
}

function errorState(error: unknown): IncidentMutationState {
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "Incident action failed unexpectedly.",
    submissionId: crypto.randomUUID(),
  };
}

function resolveIncidentRedirect(formData: FormData, incidentId: string) {
  return (
    optionalTrimmedString(formData, "redirectPath") ??
    `/incidents/${incidentId}?tab=overview`
  );
}

function revalidateIncidentViews(incidentId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/incidents");
  revalidatePath(`/incidents/${incidentId}`);
}

export async function transitionIncidentAction(
  _previousState: IncidentMutationState,
  formData: FormData,
): Promise<IncidentMutationState> {
  try {
    const incidentId = requiredTrimmedString(formData, "incidentId", "Incident");
    const transition = requiredTrimmedString(
      formData,
      "transition",
      "Transition",
    );
    const reason = optionalTrimmedString(formData, "reason");
    const resolutionSummary = optionalTrimmedString(
      formData,
      "resolutionSummary",
    );

    const payload: Record<string, unknown> = { transition };

    if (reason) {
      payload.reason = reason;
    }
    if (resolutionSummary) {
      payload.resolutionSummary = resolutionSummary;
    }

    await incidentApiRequest(`/incidents/${incidentId}/transitions`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    revalidateIncidentViews(incidentId);

    return successState(
      "Incident status updated.",
      resolveIncidentRedirect(formData, incidentId),
    );
  } catch (error) {
    return errorState(error);
  }
}

export async function changeIncidentSeverityAction(
  _previousState: IncidentMutationState,
  formData: FormData,
): Promise<IncidentMutationState> {
  try {
    const incidentId = requiredTrimmedString(formData, "incidentId", "Incident");
    const severity = optionalInt(formData, "severity");
    const reason = requiredTrimmedString(formData, "reason", "Reason");

    if (!severity) {
      throw new Error("Severity is required.");
    }

    await incidentApiRequest(`/incidents/${incidentId}/severity`, {
      method: "POST",
      body: JSON.stringify({ severity, reason }),
    });

    revalidateIncidentViews(incidentId);

    return successState(
      "Severity updated.",
      resolveIncidentRedirect(formData, incidentId),
    );
  } catch (error) {
    return errorState(error);
  }
}

export async function assignIncidentCommanderAction(
  _previousState: IncidentMutationState,
  formData: FormData,
): Promise<IncidentMutationState> {
  try {
    const incidentId = requiredTrimmedString(formData, "incidentId", "Incident");
    const userId = resolveOptionalEntityId(
      formData,
      "userId",
      "userManualId",
    );

    if (!userId) {
      throw new Error("Commander is required.");
    }

    await incidentApiRequest(`/incidents/${incidentId}/commander`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });

    revalidateIncidentViews(incidentId);

    return successState(
      "Commander assigned.",
      resolveIncidentRedirect(formData, incidentId),
    );
  } catch (error) {
    return errorState(error);
  }
}

export async function addIncidentParticipantAction(
  _previousState: IncidentMutationState,
  formData: FormData,
): Promise<IncidentMutationState> {
  try {
    const incidentId = requiredTrimmedString(formData, "incidentId", "Incident");
    const userId = resolveOptionalEntityId(
      formData,
      "userId",
      "userManualId",
    );
    const role = requiredTrimmedString(formData, "role", "Role");

    if (!userId) {
      throw new Error("Participant is required.");
    }

    await incidentApiRequest(`/incidents/${incidentId}/participants`, {
      method: "POST",
      body: JSON.stringify({ userId, role }),
    });

    revalidateIncidentViews(incidentId);

    return successState(
      "Participant added.",
      resolveIncidentRedirect(formData, incidentId),
    );
  } catch (error) {
    return errorState(error);
  }
}

export async function removeIncidentParticipantAction(
  _previousState: IncidentMutationState,
  formData: FormData,
): Promise<IncidentMutationState> {
  try {
    const incidentId = requiredTrimmedString(formData, "incidentId", "Incident");
    const userId = requiredTrimmedString(formData, "userId", "Participant");

    await incidentApiRequest(`/incidents/${incidentId}/participants/${userId}`, {
      method: "DELETE",
    });

    revalidateIncidentViews(incidentId);

    return successState(
      "Participant removed.",
      resolveIncidentRedirect(formData, incidentId),
    );
  } catch (error) {
    return errorState(error);
  }
}

function optionalUuidList(formData: FormData, key: string) {
  const value = optionalTrimmedString(formData, key);

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalLocation(formData: FormData) {
  const latRaw = optionalTrimmedString(formData, "lat");
  const lonRaw = optionalTrimmedString(formData, "lon");

  if (!latRaw && !lonRaw) {
    return null;
  }

  if (!latRaw || !lonRaw) {
    throw new Error("Both latitude and longitude are required when location is set.");
  }

  const lat = Number(latRaw);
  const lon = Number(lonRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Location must use valid numeric coordinates.");
  }

  return { lat, lon };
}

export async function submitIncidentSitrepAction(
  _previousState: IncidentMutationState,
  formData: FormData,
): Promise<IncidentMutationState> {
  try {
    const incidentId = requiredTrimmedString(formData, "incidentId", "Incident");
    const text = requiredTrimmedString(formData, "text", "Report");
    const severity = optionalInt(formData, "severity");
    const attachments = optionalUuidList(formData, "attachments");
    const location = optionalLocation(formData);

    const payload: Record<string, unknown> = { text };

    if (severity) {
      payload.severity = severity;
    }
    if (attachments.length > 0) {
      payload.attachments = attachments;
    }
    if (location) {
      payload.location = location;
    }

    await incidentApiRequest(`/incidents/${incidentId}/sitreps`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    revalidateIncidentViews(incidentId);

    return successState(
      "Situation report submitted.",
      resolveIncidentRedirect(formData, incidentId),
    );
  } catch (error) {
    return errorState(error);
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

type IncidentIndexMutationStatus = "idle" | "success" | "error";

export type IncidentIndexMutationState = {
  status: IncidentIndexMutationStatus;
  message: string;
  redirectTo?: string;
  submissionId?: string;
};

export const INITIAL_INCIDENT_INDEX_MUTATION_STATE: IncidentIndexMutationState = {
  status: "idle",
  message: "",
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const INCIDENT_CATEGORY_SET = new Set([
  "earthquake",
  "flood",
  "fire",
  "wildfire",
  "industrial",
  "cbrn",
  "mass_gathering",
  "medical",
  "transport",
  "other",
]);

const INCIDENT_BATCH_LIMIT = 25;

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

function requiredInt(formData: FormData, key: string, label: string) {
  const value = optionalInt(formData, key);

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
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

function resolveIndexRedirect(formData: FormData) {
  return optionalTrimmedString(formData, "redirectPath") ?? "/incidents";
}

function revalidateIncidentIndexViews() {
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/incidents");
}

function successState(
  message: string,
  redirectTo?: string,
): IncidentIndexMutationState {
  return {
    status: "success",
    message,
    redirectTo,
    submissionId: crypto.randomUUID(),
  };
}

function errorState(error: unknown): IncidentIndexMutationState {
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "Incident action failed unexpectedly.",
    submissionId: crypto.randomUUID(),
  };
}

export async function createIncidentAction(
  _previousState: IncidentIndexMutationState,
  formData: FormData,
): Promise<IncidentIndexMutationState> {
  try {
    const title = requiredTrimmedString(formData, "title", "Title");
    const category = requiredTrimmedString(formData, "category", "Category");
    const severity = optionalInt(formData, "severity");
    const description = optionalTrimmedString(formData, "description");
    const classification = optionalInt(formData, "classification");
    const commanderId = resolveOptionalEntityId(
      formData,
      "commanderId",
      "commanderManualId",
    );
    const parentId = resolveOptionalEntityId(
      formData,
      "parentId",
      "parentManualId",
    );
    const submitMode = stringField(formData, "submitMode").trim();

    if (!severity) {
      throw new Error("Severity is required.");
    }

    const payload: Record<string, unknown> = {
      title,
      category,
      severity,
    };

    if (description) {
      payload.description = description;
    }
    if (classification) {
      payload.classification = classification;
    }
    if (commanderId) {
      payload.commanderId = commanderId;
    }
    if (parentId) {
      payload.parentId = parentId;
    }

    const response = await incidentApiRequest<{ data: { id: string } }>(
      "/incidents",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    revalidateIncidentIndexViews();

    if (submitMode === "stay") {
      return successState("Incident created and kept on the intake board.", resolveIndexRedirect(formData));
    }

    return successState(
      "Incident created.",
      `/incidents/${response.data.id}?tab=overview`,
    );
  } catch (error) {
    return errorState(error);
  }
}

type ParsedBatchIncidentLine = {
  title: string;
  category: string;
  severity: number;
  description: string | null;
};

function parseBatchLines(formData: FormData): ParsedBatchIncidentLine[] {
  const raw = requiredTrimmedString(formData, "batchLines", "Batch lines");
  const defaultCategory = requiredTrimmedString(
    formData,
    "batchDefaultCategory",
    "Default category",
  );
  const defaultSeverity = requiredInt(
    formData,
    "batchDefaultSeverity",
    "Default severity",
  );

  if (!INCIDENT_CATEGORY_SET.has(defaultCategory)) {
    throw new Error("Default category is invalid.");
  }

  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (rows.length === 0) {
    throw new Error("Add at least one batch line.");
  }
  if (rows.length > INCIDENT_BATCH_LIMIT) {
    throw new Error(`Batch intake is limited to ${INCIDENT_BATCH_LIMIT} incidents per submit.`);
  }

  return rows.map((line, index) => {
    const segments = line.split("|").map((segment) => segment.trim());
    const title = segments[0] ?? "";
    const category = segments[1] || defaultCategory;
    const severityRaw = segments[2] || String(defaultSeverity);
    const severity = Number(severityRaw);
    const description = segments.slice(3).join(" | ").trim() || null;

    if (!title) {
      throw new Error(`Line ${index + 1}: title is required.`);
    }
    if (!INCIDENT_CATEGORY_SET.has(category)) {
      throw new Error(`Line ${index + 1}: category must be one of the incident presets.`);
    }
    if (!Number.isInteger(severity) || severity < 1 || severity > 4) {
      throw new Error(`Line ${index + 1}: severity must be a whole number between 1 and 4.`);
    }

    return {
      title,
      category,
      severity,
      description,
    };
  });
}

export async function bulkCreateIncidentsAction(
  _previousState: IncidentIndexMutationState,
  formData: FormData,
): Promise<IncidentIndexMutationState> {
  try {
    const lines = parseBatchLines(formData);
    const classification = optionalInt(formData, "batchClassification");
    const commanderId = resolveOptionalEntityId(
      formData,
      "batchCommanderId",
      "batchCommanderManualId",
    );
    let createdCount = 0;

    for (const [index, line] of lines.entries()) {
      const payload: Record<string, unknown> = {
        title: line.title,
        category: line.category,
        severity: line.severity,
      };

      if (line.description) {
        payload.description = line.description;
      }
      if (classification) {
        payload.classification = classification;
      }
      if (commanderId) {
        payload.commanderId = commanderId;
      }

      try {
        await incidentApiRequest("/incidents", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        createdCount += 1;
      } catch (error) {
        if (createdCount > 0) {
          revalidateIncidentIndexViews();
          return errorState(
            new Error(
              `Created ${createdCount} incidents before line ${index + 1} failed: ${
                error instanceof Error ? error.message : "unexpected error"
              }`,
            ),
          );
        }
        throw error;
      }
    }

    revalidateIncidentIndexViews();

    return successState(
      `${createdCount} incidents created from batch intake.`,
      resolveIndexRedirect(formData),
    );
  } catch (error) {
    return errorState(error);
  }
}

export async function openIncidentFromIndexAction(
  _previousState: IncidentIndexMutationState,
  formData: FormData,
): Promise<IncidentIndexMutationState> {
  try {
    const incidentId = requiredTrimmedString(formData, "incidentId", "Incident");

    await incidentApiRequest(`/incidents/${incidentId}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: "open" }),
    });

    revalidateIncidentIndexViews();

    return successState("Draft incident opened.", resolveIndexRedirect(formData));
  } catch (error) {
    return errorState(error);
  }
}

export async function raiseIncidentSeverityFromIndexAction(
  _previousState: IncidentIndexMutationState,
  formData: FormData,
): Promise<IncidentIndexMutationState> {
  try {
    const incidentId = requiredTrimmedString(formData, "incidentId", "Incident");
    const targetSeverity = requiredInt(
      formData,
      "targetSeverity",
      "Target severity",
    );
    const reason =
      optionalTrimmedString(formData, "reason") ??
      "Quick severity raise from incident index.";

    await incidentApiRequest(`/incidents/${incidentId}/severity`, {
      method: "POST",
      body: JSON.stringify({ severity: targetSeverity, reason }),
    });

    revalidateIncidentIndexViews();

    return successState("Severity raised.", resolveIndexRedirect(formData));
  } catch (error) {
    return errorState(error);
  }
}

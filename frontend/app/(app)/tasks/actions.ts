"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  getTaskHref,
  type TaskStatus,
  type TaskTransitionCode,
} from "@/lib/api/task-workspace";

type TaskMutationStatus = "idle" | "success" | "error";

export type TaskMutationState = {
  status: TaskMutationStatus;
  message: string;
  redirectTo?: string;
  submissionId?: string;
};

export const INITIAL_TASK_MUTATION_STATE: TaskMutationState = {
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

function optionalNumber(formData: FormData, key: string) {
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

function optionalDateTimeIso(formData: FormData, key: string) {
  const raw = stringField(formData, key).trim();

  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${key} must be a valid date.`);
  }

  return parsed.toISOString();
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

async function taskApiRequest<T>(
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

function successState(message: string, redirectTo?: string): TaskMutationState {
  return {
    status: "success",
    message,
    redirectTo,
    submissionId: crypto.randomUUID(),
  };
}

function errorState(error: unknown): TaskMutationState {
  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "Task action failed unexpectedly.",
    submissionId: crypto.randomUUID(),
  };
}

function revalidateTaskViews() {
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/incidents");
}

function resolveTaskRedirect(formData: FormData, taskId: string) {
  const redirectPath = optionalTrimmedString(formData, "redirectPath");

  if (redirectPath) {
    return redirectPath;
  }

  const redirectBasePath = optionalTrimmedString(formData, "redirectBasePath");

  if (redirectBasePath) {
    const separator = redirectBasePath.includes("?") ? "&" : "?";
    return `${redirectBasePath}${separator}taskId=${taskId}`;
  }

  return getTaskHref(taskId);
}

function mapTransitionToStatus(transition: TaskTransitionCode): TaskStatus {
  switch (transition) {
    case "start":
    case "unblock":
    case "reject":
      return "in_progress";
    case "block":
      return "blocked";
    case "submit_for_review":
      return "review";
    case "complete":
    case "approve":
      return "done";
    case "cancel":
      return "cancelled";
  }
}

export async function reorderTaskBoardAction(input: {
  taskId: string;
  sourceStatus: TaskStatus;
  targetStatus: TaskStatus;
  position: number;
}) {
  try {
    const targetPosition = Math.max(0, Math.floor(input.position));

    if (input.sourceStatus !== input.targetStatus) {
      const transitionsResponse = await taskApiRequest<{
        data: Array<{
          code: TaskTransitionCode;
          label: string;
          requires: string[];
        }>;
      }>(`/tasks/${input.taskId}/transitions/available`, {
        method: "GET",
      });

      const matchingTransition = transitionsResponse.data.find(
        (transition) =>
          mapTransitionToStatus(transition.code) === input.targetStatus &&
          !transition.requires.includes("reason"),
      );

      if (!matchingTransition) {
        return {
          ok: false,
          message:
            "This lane move is not available without an explicit transition reason.",
        };
      }

      await taskApiRequest(`/tasks/${input.taskId}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: matchingTransition.code }),
      });
    }

    await taskApiRequest(`/tasks/${input.taskId}/position`, {
      method: "PATCH",
      body: JSON.stringify({ position: targetPosition }),
    });

    revalidateTaskViews();

    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Board move failed unexpectedly.",
    };
  }
}

export async function createTaskAction(
  _previousState: TaskMutationState,
  formData: FormData,
): Promise<TaskMutationState> {
  try {
    const title = requiredTrimmedString(formData, "title", "Title");
    const description = optionalTrimmedString(formData, "description");
    const priority = optionalNumber(formData, "priority");
    const incidentId = optionalTrimmedString(formData, "incidentId");
    const assigneeId = resolveOptionalEntityId(
      formData,
      "assigneeId",
      "assigneeManualId",
    );
    const dueAt = optionalDateTimeIso(formData, "dueAt");
    const slaBreachAt = optionalDateTimeIso(formData, "slaBreachAt");

    const payload: Record<string, unknown> = { title };

    if (description) {
      payload.description = description;
    }
    if (priority) {
      payload.priority = priority;
    }
    if (incidentId) {
      payload.incidentId = incidentId;
    }
    if (assigneeId) {
      payload.assigneeId = assigneeId;
    }
    if (dueAt) {
      payload.dueAt = dueAt;
    }
    if (slaBreachAt) {
      payload.slaBreachAt = slaBreachAt;
    }

    const response = await taskApiRequest<{ data: { id: string } }>("/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    revalidateTaskViews();

    return successState(
      "Task created.",
      resolveTaskRedirect(formData, response.data.id),
    );
  } catch (error) {
    return errorState(error);
  }
}

export async function updateTaskAction(
  _previousState: TaskMutationState,
  formData: FormData,
): Promise<TaskMutationState> {
  try {
    const taskId = requiredTrimmedString(formData, "taskId", "Task");
    const title = requiredTrimmedString(formData, "title", "Title");
    const description = optionalTrimmedString(formData, "description");
    const priority = optionalNumber(formData, "priority");
    const dueAt = optionalDateTimeIso(formData, "dueAt");
    const slaBreachAt = optionalDateTimeIso(formData, "slaBreachAt");

    const payload: Record<string, unknown> = {
      title,
      description,
      dueAt,
      slaBreachAt,
    };

    if (priority) {
      payload.priority = priority;
    }

    await taskApiRequest(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    revalidateTaskViews();

    return successState("Task updated.", resolveTaskRedirect(formData, taskId));
  } catch (error) {
    return errorState(error);
  }
}

export async function assignTaskAction(
  _previousState: TaskMutationState,
  formData: FormData,
): Promise<TaskMutationState> {
  try {
    const taskId = requiredTrimmedString(formData, "taskId", "Task");
    const assigneeId = resolveOptionalEntityId(
      formData,
      "assigneeId",
      "assigneeManualId",
    );
    const reason = optionalTrimmedString(formData, "reason");

    if (!assigneeId) {
      throw new Error("Assignee is required.");
    }

    const payload: Record<string, unknown> = { assigneeId };

    if (reason) {
      payload.reason = reason;
    }

    await taskApiRequest(`/tasks/${taskId}/assign`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    revalidateTaskViews();

    return successState(
      "Assignment updated.",
      resolveTaskRedirect(formData, taskId),
    );
  } catch (error) {
    return errorState(error);
  }
}

export async function transitionTaskAction(
  _previousState: TaskMutationState,
  formData: FormData,
): Promise<TaskMutationState> {
  try {
    const taskId = requiredTrimmedString(formData, "taskId", "Task");
    const transition = requiredTrimmedString(
      formData,
      "transition",
      "Transition",
    );
    const reason = optionalTrimmedString(formData, "reason");

    const payload: Record<string, unknown> = { transition };

    if (reason) {
      payload.reason = reason;
    }

    await taskApiRequest(`/tasks/${taskId}/transitions`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    revalidateTaskViews();

    return successState("Status updated.", resolveTaskRedirect(formData, taskId));
  } catch (error) {
    return errorState(error);
  }
}

export async function addTaskCommentAction(
  _previousState: TaskMutationState,
  formData: FormData,
): Promise<TaskMutationState> {
  try {
    const taskId = requiredTrimmedString(formData, "taskId", "Task");
    const body = requiredTrimmedString(formData, "body", "Comment");

    await taskApiRequest(`/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });

    revalidateTaskViews();

    return successState("Comment added.", resolveTaskRedirect(formData, taskId));
  } catch (error) {
    return errorState(error);
  }
}

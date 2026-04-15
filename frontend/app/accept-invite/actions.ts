"use server";

type InviteAcceptStatus = "idle" | "success" | "error";

export type InviteAcceptState = {
  status: InviteAcceptStatus;
  message: string;
  submissionId?: string;
};

export const INITIAL_INVITE_ACCEPT_STATE: InviteAcceptState = {
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

    if (Array.isArray(message) && message.length > 0) {
      return message.join(", ");
    }

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return `Invitation request failed with status ${status}.`;
}

export async function acceptInvitationAction(
  _previousState: InviteAcceptState,
  formData: FormData,
): Promise<InviteAcceptState> {
  try {
    const token = stringField(formData, "token").trim();
    const email = stringField(formData, "email").trim();
    const fullName = stringField(formData, "fullName").trim();
    const password = stringField(formData, "password").trim();
    const phone = stringField(formData, "phone").trim();

    if (!token || !email || !fullName || !password) {
      throw new Error("Token, email, full name, and password are required.");
    }

    const response = await fetch(`${API_BASE_URL}/auth/accept-invite`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        token,
        email,
        fullName,
        password,
        phone: phone || undefined,
      }),
    });
    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new Error(getErrorMessage(body, response.status));
    }

    return {
      status: "success",
      message:
        "Invitation accepted. The liaison account is ready for sign-in through the platform auth flow.",
      submissionId: crypto.randomUUID(),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Invitation acceptance failed unexpectedly.",
      submissionId: crypto.randomUUID(),
    };
  }
}

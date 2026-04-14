import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const DEFAULT_TIMELINE_LIMIT = 12;
const DEFAULT_SITREP_LIMIT = 8;

export const dynamic = "force-dynamic";

function appendQueryParam(
  searchParams: URLSearchParams,
  key: string,
  value: string | number | null | undefined,
) {
  if (value !== undefined && value !== null && value !== "") {
    searchParams.set(key, String(value));
  }
}

function parseFlag(value: string | null, defaultValue: boolean) {
  if (value === null) {
    return defaultValue;
  }

  return value !== "0" && value.toLowerCase() !== "false";
}

function parseLimit(
  value: string | null,
  defaultValue: number,
  maxValue: number,
) {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.max(1, Math.min(parsed, maxValue));
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

async function proxyIncidentApi<T>(path: string): Promise<T> {
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const includeTimeline = parseFlag(
      request.nextUrl.searchParams.get("includeTimeline"),
      true,
    );
    const includeSitreps = parseFlag(
      request.nextUrl.searchParams.get("includeSitreps"),
      true,
    );

    if (!includeTimeline && !includeSitreps) {
      return NextResponse.json(
        { message: "At least one activity stream must be requested." },
        { status: 400 },
      );
    }

    const timelineCursor = request.nextUrl.searchParams.get("timelineCursor");
    const sitrepCursor = request.nextUrl.searchParams.get("sitrepCursor");
    const timelineLimit = parseLimit(
      request.nextUrl.searchParams.get("timelineLimit"),
      DEFAULT_TIMELINE_LIMIT,
      100,
    );
    const sitrepLimit = parseLimit(
      request.nextUrl.searchParams.get("sitrepLimit"),
      DEFAULT_SITREP_LIMIT,
      50,
    );

    const timelinePromise = includeTimeline
      ? (() => {
          const searchParams = new URLSearchParams();
          appendQueryParam(searchParams, "limit", timelineLimit);
          appendQueryParam(searchParams, "cursor", timelineCursor);
          const query = searchParams.toString();

          return proxyIncidentApi<unknown>(
            `/incidents/${id}/timeline${query ? `?${query}` : ""}`,
          );
        })()
      : Promise.resolve(null);

    const sitrepsPromise = includeSitreps
      ? (() => {
          const searchParams = new URLSearchParams();
          appendQueryParam(searchParams, "limit", sitrepLimit);
          appendQueryParam(searchParams, "cursor", sitrepCursor);
          const query = searchParams.toString();

          return proxyIncidentApi<unknown>(
            `/incidents/${id}/sitreps${query ? `?${query}` : ""}`,
          );
        })()
      : Promise.resolve(null);

    const [timeline, sitreps] = await Promise.all([
      timelinePromise,
      sitrepsPromise,
    ]);

    return NextResponse.json(
      {
        timeline,
        sitreps,
        fetchedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Incident activity request failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}

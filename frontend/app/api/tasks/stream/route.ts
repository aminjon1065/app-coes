import { cookies } from "next/headers";

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const url = new URL(request.url);
    const params = new URLSearchParams();
    const incidentId = url.searchParams.get("incidentId");
    const taskId = url.searchParams.get("taskId");

    if (incidentId) {
      params.set("incidentId", incidentId);
    }
    if (taskId) {
      params.set("taskId", taskId);
    }

    const headers = new Headers({
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
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

    const upstream = await fetch(
      `${API_BASE_URL}/tasks/stream${params.toString() ? `?${params.toString()}` : ""}`,
      {
        headers,
        cache: "no-store",
      },
    );

    if (!upstream.ok || !upstream.body) {
      const message = await upstream.text();
      return new Response(message || "Task stream request failed.", {
        status: upstream.status || 500,
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Task stream request failed unexpectedly.",
      { status: 500 },
    );
  }
}

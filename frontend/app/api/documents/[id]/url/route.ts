import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

async function parseResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const versionId = new URL(request.url).searchParams.get("versionId");

  if (!versionId) {
    return NextResponse.json({ message: "versionId is required." }, { status: 400 });
  }

  const headers = new Headers({ Accept: "application/json" });
  const token =
    process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const serializedCookies = (await cookies()).toString();

  if (serializedCookies) {
    headers.set("Cookie", serializedCookies);
  }

  const response = await fetch(
    `${API_BASE_URL}/documents/${id}/versions/${versionId}/url`,
    {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );
  const body = await parseResponseBody(response);

  if (!response.ok) {
    return NextResponse.json(body ?? { message: "Document URL request failed." }, {
      status: response.status,
    });
  }

  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data?: { url?: string } }).data
      : null;

  return NextResponse.json({ url: data?.url ?? null });
}

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

export async function POST(request: Request) {
  const formData = await request.formData();
  const headers = new Headers();
  const token =
    process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

  headers.set("Accept", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const serializedCookies = (await cookies()).toString();

  if (serializedCookies) {
    headers.set("Cookie", serializedCookies);
  }

  const response = await fetch(`${API_BASE_URL}/files/upload`, {
    method: "POST",
    headers,
    body: formData,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    return NextResponse.json(
      body ?? { message: `Upload failed with status ${response.status}.` },
      { status: response.status },
    );
  }

  return NextResponse.json(body);
}

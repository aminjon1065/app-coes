import { NextResponse } from "next/server";
import { loadGisWorkspace } from "@/lib/api/gis-workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const incidentId = url.searchParams.get("incidentId");
  const workspace = await loadGisWorkspace({ incidentId });

  return NextResponse.json({
    data: workspace,
    fetchedAt: new Date().toISOString(),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { loadTaskWorkspace } from "@/lib/api/task-workspace";

export const dynamic = "force-dynamic";

function firstQueryValue(value: string | string[] | null) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

export async function GET(request: NextRequest) {
  try {
    const taskId = firstQueryValue(request.nextUrl.searchParams.get("taskId"));
    const incidentId = firstQueryValue(
      request.nextUrl.searchParams.get("incidentId"),
    );
    const workspace = await loadTaskWorkspace({
      taskId: taskId || undefined,
      incidentId: incidentId || undefined,
    });

    return NextResponse.json(
      {
        data: workspace,
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
            : "Task workspace refresh failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}

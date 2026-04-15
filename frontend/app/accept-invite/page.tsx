import Link from "next/link";
import { AlertTriangle, ArrowLeft, Orbit } from "lucide-react";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

type AcceptInvitePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ResolvedInvitation = {
  id: string;
  tenantId: string;
  email: string;
  roleCode: string;
  incidentScope: string[];
  expiresAt: string;
  acceptedAt: string | null;
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function resolveInvitation(token: string): Promise<{
  invitation: ResolvedInvitation | null;
  error: string | null;
}> {
  if (!token) {
    return {
      invitation: null,
      error: "Invitation token is missing.",
    };
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/auth/invitations/resolve?token=${encodeURIComponent(token)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    const body = (await response.json()) as {
      data?: ResolvedInvitation;
      message?: string;
    };

    if (!response.ok || !body.data) {
      throw new Error(body.message ?? "Invitation could not be resolved.");
    }

    return {
      invitation: body.data,
      error: null,
    };
  } catch (error) {
    return {
      invitation: null,
      error:
        error instanceof Error
          ? error.message
          : "Invitation could not be resolved.",
    };
  }
}

export default async function AcceptInvitePage({
  searchParams,
}: AcceptInvitePageProps) {
  const resolvedSearchParams = await searchParams;
  const token = firstParam(resolvedSearchParams.token)?.trim() ?? "";
  const { invitation, error } = await resolveInvitation(token);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-12">
      <section className="w-full rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.96),rgba(17,26,42,0.9))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to platform
        </Link>

        <div className="mt-5 flex items-center gap-3 text-cyan-100">
          <Orbit className="h-5 w-5" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-200/70">
            Inter-agency liaison
          </span>
        </div>
        <h1 className="mt-3 text-3xl font-medium leading-tight text-white">
          Accept incident liaison access.
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          This invitation creates a scoped liaison account for shared incident
          coordination inside the tenant workspace.
        </p>

        {error ? (
          <div className="mt-6 rounded-[24px] border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Invitation unavailable
            </div>
            <div className="mt-2 leading-6">{error}</div>
          </div>
        ) : null}

        {!error ? (
          <div className="mt-6">
            <AcceptInviteForm token={token} invitation={invitation} />
          </div>
        ) : null}
      </section>
    </main>
  );
}

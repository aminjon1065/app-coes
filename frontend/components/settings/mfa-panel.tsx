"use client";

import Image from "next/image";
import { useActionState, useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { KeyRound, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import type { SecurityWorkspace } from "@/lib/api/security-workspace";
import {
  disableMfaAction,
  enrollMfaAction,
  INITIAL_MFA_CODE_MUTATION_STATE,
  INITIAL_MFA_ENROLL_MUTATION_STATE,
  verifyMfaAction,
} from "@/app/(app)/settings/actions";

function StatusMessage({
  tone,
  message,
}: {
  tone: "success" | "error" | "info";
  message: string;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
      : tone === "error"
        ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
        : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>
      {message}
    </div>
  );
}

function SubmitButton({
  idleLabel,
  pendingLabel,
  icon: Icon,
  disabled = false,
}: {
  idleLabel: string;
  pendingLabel: string;
  icon: typeof Smartphone;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon className="h-4 w-4" />
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

export function MfaPanel({
  workspace,
}: {
  workspace: SecurityWorkspace;
}) {
  const router = useRouter();
  const [enrollState, enrollAction] = useActionState(
    enrollMfaAction,
    INITIAL_MFA_ENROLL_MUTATION_STATE,
  );
  const [verifyState, verifyAction] = useActionState(
    verifyMfaAction,
    INITIAL_MFA_CODE_MUTATION_STATE,
  );
  const [disableState, disableAction] = useActionState(
    disableMfaAction,
    INITIAL_MFA_CODE_MUTATION_STATE,
  );
  const handledVerifySubmissionId = useRef<string | null>(null);
  const handledDisableSubmissionId = useRef<string | null>(null);

  useEffect(() => {
    if (
      verifyState.status !== "success" ||
      !verifyState.submissionId ||
      handledVerifySubmissionId.current === verifyState.submissionId
    ) {
      return;
    }

    handledVerifySubmissionId.current = verifyState.submissionId;

    startTransition(() => {
      router.refresh();
    });
  }, [router, verifyState.status, verifyState.submissionId]);

  useEffect(() => {
    if (
      disableState.status !== "success" ||
      !disableState.submissionId ||
      handledDisableSubmissionId.current === disableState.submissionId
    ) {
      return;
    }

    handledDisableSubmissionId.current = disableState.submissionId;

    startTransition(() => {
      router.refresh();
    });
  }, [disableState.status, disableState.submissionId, router]);

  const manageDisabled =
    workspace.source !== "api" ||
    !workspace.currentUser.permissions?.includes("iam.profile.manage");
  const enrollmentQrCode =
    enrollState.status === "success" ? enrollState.qrCodeDataUrl ?? null : null;
  const showEnrollmentStep =
    !workspace.currentUser.mfaEnabled && Boolean(enrollmentQrCode);

  return (
    <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.22)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
              Self-service security
            </p>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              Protect the active command account with MFA.
            </h1>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Add an authenticator-based second factor for this operator profile.
              The backend now supports enrollment, verification, and secure removal.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Security posture
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {workspace.currentUser.mfaEnabled ? "MFA enforced" : "Single-factor session"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Refreshed {workspace.refreshedAt}
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3 text-cyan-100">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-sm font-medium text-white">Current state</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {workspace.currentUser.mfaEnabled
                ? "Authenticator verification is active for this session owner."
                : "No second factor is currently required after password sign-in."}
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3 text-cyan-100">
              <KeyRound className="h-5 w-5" />
              <span className="text-sm font-medium text-white">Roles</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {workspace.currentUser.roles.join(", ") || "No active roles"}
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3 text-cyan-100">
              <Smartphone className="h-5 w-5" />
              <span className="text-sm font-medium text-white">Authenticator</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Compatible with Google Authenticator, 1Password, Microsoft Authenticator, and similar TOTP apps.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            MFA control
          </p>
          <h2 className="mt-2 text-xl font-medium text-white">
            {workspace.currentUser.mfaEnabled ? "Disable MFA" : "Enable MFA"}
          </h2>

          <div className="mt-5 space-y-4">
            {manageDisabled ? (
              <StatusMessage
                tone="info"
                message="Security mutation actions are disabled in mock fallback mode."
              />
            ) : null}

            {!workspace.currentUser.mfaEnabled ? (
              <>
                <form action={enrollAction} className="space-y-4">
                  <p className="text-sm leading-6 text-slate-300">
                    Start enrollment to receive a QR code for the authenticator app.
                  </p>

                  {enrollState.status === "error" ? (
                    <StatusMessage tone="error" message={enrollState.message} />
                  ) : null}

                  {enrollState.status === "success" ? (
                    <StatusMessage tone="success" message={enrollState.message} />
                  ) : null}

                  <SubmitButton
                    idleLabel="Generate QR code"
                    pendingLabel="Generating QR code..."
                    icon={Smartphone}
                    disabled={manageDisabled}
                  />
                </form>

                {showEnrollmentStep ? (
                  <div className="rounded-[28px] border border-white/10 bg-black/16 p-4">
                    <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
                      <div className="rounded-[24px] border border-white/10 bg-white p-3">
                        <Image
                          src={enrollmentQrCode ?? ""}
                          alt="MFA enrollment QR code"
                          width={256}
                          height={256}
                          unoptimized
                          className="h-auto w-full rounded-2xl"
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                            Manual secret
                          </div>
                          <div className="mt-2 break-all font-mono text-cyan-100">
                            {enrollState.secret}
                          </div>
                        </div>

                        <form action={verifyAction} className="space-y-4">
                          <input
                            name="code"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="Enter 6-digit code"
                            className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35"
                          />

                          {verifyState.status === "error" ? (
                            <StatusMessage tone="error" message={verifyState.message} />
                          ) : null}

                          {verifyState.status === "success" ? (
                            <StatusMessage tone="success" message={verifyState.message} />
                          ) : null}

                          <SubmitButton
                            idleLabel="Confirm MFA"
                            pendingLabel="Confirming..."
                            icon={ShieldCheck}
                            disabled={manageDisabled}
                          />
                        </form>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <form action={disableAction} className="space-y-4">
                <p className="text-sm leading-6 text-slate-300">
                  MFA is currently active. To remove it, confirm the current password for this account.
                </p>

                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Current password"
                  className="w-full rounded-2xl border border-white/10 bg-black/14 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/35"
                />

                {disableState.status === "error" ? (
                  <StatusMessage tone="error" message={disableState.message} />
                ) : null}

                {disableState.status === "success" ? (
                  <StatusMessage tone="success" message={disableState.message} />
                ) : null}

                <button
                  type="submit"
                  disabled={manageDisabled}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-300/30 bg-rose-300/10 px-4 py-2.5 text-sm font-medium text-rose-50 transition hover:bg-rose-300/16 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ShieldOff className="h-4 w-4" />
                  Disable MFA
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            Operational note
          </p>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Break-glass and MFA backend flows are now live. This panel only manages the
            current operator account and does not expose tenant-wide security administration.
          </p>
        </div>
      </div>
    </section>
  );
}

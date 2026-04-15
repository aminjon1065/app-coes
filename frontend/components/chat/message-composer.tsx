"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, SendHorizontal, Smile } from "lucide-react";
import { useFormStatus } from "react-dom";
import {
  INITIAL_CHAT_MUTATION_STATE,
  sendChatMessageAction,
} from "@/app/(app)/chat/actions";
import type { ChatSocket } from "@/lib/chat-socket";
import { cn } from "@/lib/utils";

const EMOJI_PRESETS = ["✅", "🚨", "📍", "🙏", "👀"];

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/12 px-4 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <SendHorizontal className="h-4 w-4" />
      {pending ? "Sending" : "Send"}
    </button>
  );
}

export function MessageComposer({
  channelId,
  socket,
  disabled = false,
  compact = false,
}: {
  channelId: string | null;
  socket: ChatSocket | null;
  disabled?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    sendChatMessageAction,
    INITIAL_CHAT_MUTATION_STATE,
  );
  const [content, setContent] = useState("");
  const [fileId, setFileId] = useState("");
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledSubmissionId = useRef<string | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, compact ? 140 : 190)}px`;
  }, [compact, content]);

  useEffect(() => {
    if (
      state.status !== "success" ||
      !state.submissionId ||
      handledSubmissionId.current === state.submissionId
    ) {
      return;
    }

    handledSubmissionId.current = state.submissionId;
    setContent("");
    setFileId("");
    setUploadLabel("");

    startTransition(() => {
      router.refresh();
    });
  }, [router, state.status, state.submissionId]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (channelId) {
        socket?.emit("typing_stop", channelId);
      }
    };
  }, [channelId, socket]);

  function emitTyping() {
    if (!channelId || !socket) {
      return;
    }

    socket.emit("typing_start", channelId);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("typing_stop", channelId);
    }, 1400);
  }

  async function handleUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    const data = new FormData();
    data.set("file", file);
    setUploading(true);
    setUploadError("");
    setUploadLabel(file.name);

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: data,
      });
      const body = (await response.json()) as {
        data?: { id?: string };
        message?: string;
      };

      if (!response.ok || !body.data?.id) {
        throw new Error(body.message ?? "Upload failed.");
      }

      setFileId(body.data.id);
    } catch (error) {
      setFileId("");
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const isDisabled = disabled || !channelId || uploading;

  return (
    <form action={formAction} className="rounded-[28px] border border-white/10 bg-black/18 p-4">
      <input type="hidden" name="channelId" value={channelId ?? ""} />
      <input type="hidden" name="fileId" value={fileId} />

      <textarea
        ref={textareaRef}
        name="content"
        value={content}
        disabled={isDisabled}
        placeholder={
          disabled
            ? "Composer disabled while chat is using fallback data."
            : "Type an operational update..."
        }
        onChange={(event) => {
          setContent(event.target.value);
          emitTyping();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="min-h-24 w-full resize-none border-0 bg-transparent text-sm leading-7 text-slate-100 outline-none placeholder:text-slate-600 disabled:cursor-not-allowed"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10",
              isDisabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Paperclip className="h-4 w-4" />
            Attach
            <input
              type="file"
              className="hidden"
              disabled={isDisabled}
              onChange={(event) => void handleUpload(event.target.files?.[0])}
            />
          </label>
          <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 px-2 py-1.5">
            <Smile className="h-4 w-4 text-slate-500" />
            {EMOJI_PRESETS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  setContent((current) => `${current}${emoji}`);
                  emitTyping();
                }}
                className="rounded-lg px-1.5 py-0.5 text-sm transition hover:bg-white/10 disabled:cursor-not-allowed"
              >
                {emoji}
              </button>
            ))}
          </div>
          {uploadLabel ? (
            <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
              {uploading ? "Uploading " : "Attached "}
              {uploadLabel}
            </span>
          ) : null}
        </div>

        <SubmitButton disabled={isDisabled || (!content.trim() && !fileId)} />
      </div>

      {state.status === "error" || uploadError ? (
        <div className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
          {uploadError || state.message}
        </div>
      ) : null}
    </form>
  );
}

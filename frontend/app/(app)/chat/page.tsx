import { MessageSquareText, RadioTower } from "lucide-react";
import { ChatWorkspaceShell } from "@/components/chat/chat-workspace-shell";
import { loadChatWorkspace } from "@/lib/api/chat-workspace";

type ChatPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const resolvedSearchParams = await searchParams;
  const channelId = firstParam(resolvedSearchParams.channelId);
  const workspace = await loadChatWorkspace({ channelId });

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 text-cyan-100">
              <MessageSquareText className="h-5 w-5" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                Chat console
              </p>
            </div>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              Operational rooms and incident conversations.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Channel list, message history, attachments, typing presence and Socket.IO updates
              now share the same backend chat module.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-2 text-cyan-100">
              <RadioTower className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Feed
              </span>
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {workspace.source === "api" ? "Live chat API" : "Mock fallback"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {workspace.channels.length} channels
            </div>
          </div>
        </div>
      </section>

      <ChatWorkspaceShell initialWorkspace={workspace} />
    </main>
  );
}

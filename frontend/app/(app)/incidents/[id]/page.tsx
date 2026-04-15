import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  ClipboardList,
  MessageSquareText,
  ShieldAlert,
  RadioTower,
  UserRound,
  Waves,
} from "lucide-react";
import { IncidentRoomPanel } from "@/components/chat/incident-room-panel";
import { IncidentActivityFeed } from "@/components/incident/incident-activity-feed";
import { IncidentCommandPanel } from "@/components/incident/incident-command-panel";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { TaskStatusBoard } from "@/components/task/task-status-board";
import { TaskWorkspaceLiveShell } from "@/components/task/task-workspace-live-shell";
import { loadChatWorkspace } from "@/lib/api/chat-workspace";
import { loadIncidentWorkspace } from "@/lib/api/incident-workspace";
import {
  formatTaskRelative,
  type TaskBoardDto,
  formatTaskTimestamp,
  getTaskBoardSignature,
} from "@/lib/api/task-workspace";

type IncidentDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function resolveIncidentTab(value: string | string[] | undefined) {
  const tab = firstParam(value);
  return tab === "tasks" || tab === "chat" ? tab : "overview";
}

function buildIncidentTaskHref(incidentId: string, taskId: string) {
  return `/incidents/${incidentId}?tab=tasks&taskId=${taskId}`;
}

function countBoardTasks(board: TaskBoardDto) {
  return Object.values(board).reduce((total, column) => total + column.length, 0);
}

export default async function IncidentDetailPage({
  params,
  searchParams,
}: IncidentDetailPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const selectedTab = resolveIncidentTab(resolvedSearchParams.tab);
  const taskId = firstParam(resolvedSearchParams.taskId);
  const [workspace, chatWorkspace] = await Promise.all([
    loadIncidentWorkspace({
      incidentId: resolvedParams.id,
      taskId,
    }),
    loadChatWorkspace({
      incidentId: resolvedParams.id,
      channelId: firstParam(resolvedSearchParams.channelId),
    }),
  ]);

  if (!workspace.incident) {
    notFound();
  }

  const { incident } = workspace;
  const incidentTaskHref = (id: string) => buildIncidentTaskHref(incident.id, id);
  const taskTabBasePath = `/incidents/${incident.id}?tab=tasks`;
  const chatTabBasePath = `/incidents/${incident.id}?tab=chat`;
  const selectedTaskPath = workspace.taskWorkspace.selectedTask
    ? buildIncidentTaskHref(incident.id, workspace.taskWorkspace.selectedTask.id)
    : taskTabBasePath;
  const initialTaskFetchedAt = new Date().toISOString();
  const activeTaskCount =
    countBoardTasks(workspace.taskWorkspace.board) -
    workspace.taskWorkspace.board.done.length -
    workspace.taskWorkspace.board.cancelled.length;
  const doneTaskCount = workspace.taskWorkspace.board.done.length;
  const overdueTaskCount = workspace.taskWorkspace.overdueTasks.length;
  const recentSitrep = workspace.sitreps[0] ?? null;
  const incidentIndex = workspace.incidents.findIndex((item) => item.id === incident.id);
  const previousIncident = incidentIndex > 0 ? workspace.incidents[incidentIndex - 1] : null;
  const nextIncident =
    incidentIndex >= 0 && incidentIndex < workspace.incidents.length - 1
      ? workspace.incidents[incidentIndex + 1]
      : null;

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <Link
              href="/incidents"
              className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to incidents
            </Link>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
              Incident detail
            </p>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              {incident.code} · {incident.title}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              {incident.description ??
                "This incident is now backed by a task-scoped operational workspace. Switch tabs below to stay inside the incident while working the board."}
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Feed
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {workspace.source === "api" ? "Incident + task APIs" : "Mock fallback"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Updated {formatTaskRelative(incident.updatedAt)}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {previousIncident ? (
            <Link
              href={`/incidents/${previousIncident.id}?tab=overview`}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
              {previousIncident.code}
            </Link>
          ) : null}
          {nextIncident ? (
            <Link
              href={`/incidents/${nextIncident.id}?tab=overview`}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
            >
              {nextIncident.code}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-100">
            Severity {incident.severity}
          </span>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-slate-200">
            Status: {incident.status}
          </span>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-slate-200">
            Category: {incident.category}
          </span>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-slate-200">
            Opened: {formatTaskTimestamp(incident.openedAt)}
          </span>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[24px] border border-white/10 bg-black/15 px-4 py-4">
            <div className="flex items-center gap-2 text-cyan-100">
              <UserRound className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Command
              </span>
            </div>
            <div className="mt-3 text-sm font-medium text-white">
              {incident.commander?.fullName ?? "Unassigned commander"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {workspace.participants.length} active participants
            </div>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-black/15 px-4 py-4">
            <div className="flex items-center gap-2 text-amber-100">
              <ClipboardList className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Open work
              </span>
            </div>
            <div className="mt-3 text-sm font-medium text-white">
              {activeTaskCount} active tasks
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {doneTaskCount} done, {workspace.taskWorkspace.myTasks.length} in my queue
            </div>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-black/15 px-4 py-4">
            <div className="flex items-center gap-2 text-rose-100">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Time risk
              </span>
            </div>
            <div className="mt-3 text-sm font-medium text-white">
              {overdueTaskCount} overdue tasks
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {recentSitrep
                ? `Latest sitrep ${formatTaskRelative(recentSitrep.reportedAt)}`
                : "No sitreps submitted yet"}
            </div>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-black/15 px-4 py-4">
            <div className="flex items-center gap-2 text-emerald-100">
              <CheckCheck className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Governance
              </span>
            </div>
            <div className="mt-3 text-sm font-medium text-white">
              Class {incident.classification}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Created {formatTaskTimestamp(incident.createdAt)}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/incidents/${incident.id}?tab=overview`}
            className={`rounded-full border px-4 py-2.5 text-sm transition ${
              selectedTab === "overview"
                ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            Overview
          </Link>
          <Link
            href={taskTabBasePath}
            className={`rounded-full border px-4 py-2.5 text-sm transition ${
              selectedTab === "tasks"
                ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            Embedded task console
          </Link>
          <Link
            href={chatTabBasePath}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition ${
              selectedTab === "chat"
                ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            <MessageSquareText className="h-4 w-4" />
            Incident chat
            {(chatWorkspace.activeChannel?.unreadCount ?? 0) > 0 ? (
              <span className="rounded-full border border-amber-300/30 bg-amber-300/12 px-2 py-0.5 text-xs text-amber-100">
                {chatWorkspace.activeChannel?.unreadCount}
              </span>
            ) : null}
          </Link>
        </div>
      </section>

      {selectedTab === "tasks" ? (
        <TaskWorkspaceLiveShell
          initialWorkspace={workspace.taskWorkspace}
          initialFetchedAt={initialTaskFetchedAt}
          taskId={taskId ?? undefined}
          incidentId={incident.id}
          defaultIncidentId={incident.id}
          redirectBasePath={taskTabBasePath}
          selectedTaskRedirectPath={selectedTaskPath}
          taskHrefBuilder={incidentTaskHref}
          myTasksTitle="Incident queue"
          myTasksSubtitle="Tasks assigned to the current operator within this incident"
          myTasksEmptyLabel="No tasks assigned inside this incident."
          overdueTitle="Incident overdue"
          overdueSubtitle="Tasks outside the due window in this incident scope"
          overdueEmptyLabel="No overdue tasks in this incident."
        />
      ) : selectedTab === "chat" ? (
        <IncidentRoomPanel
          incidentId={incident.id}
          initialWorkspace={chatWorkspace}
          participants={workspace.participants}
          compact
        />
      ) : (
        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[30px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Operational snapshot
                </p>
                <h2 className="mt-3 text-2xl font-medium text-white">
                  Current incident posture and hand-off markers.
                </h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[22px] border border-white/10 bg-black/10 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Status
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {incident.status}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Opened {formatTaskTimestamp(incident.openedAt)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-black/10 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Category
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {incident.category}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Updated {formatTaskRelative(incident.updatedAt)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-black/10 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Parent incident
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {incident.parentId ?? "Standalone incident"}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-black/10 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Tasks
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {activeTaskCount} active / {doneTaskCount} completed
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(58,24,13,0.78),rgba(33,14,14,0.7))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
                <div className="flex items-center gap-3 text-rose-100">
                  <ShieldAlert className="h-5 w-5" />
                  <span className="text-sm font-medium">Latest field signal</span>
                </div>
                <div className="mt-4 rounded-[22px] border border-white/10 bg-black/15 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-rose-100/70">
                    {recentSitrep ? "Recent sitrep" : "No sitrep yet"}
                  </div>
                  <div className="mt-3 text-sm leading-7 text-rose-50/90">
                    {recentSitrep?.text ??
                      "Submit the first sitrep from the command rail to establish a live incident narrative."}
                  </div>
                  <div className="mt-4 text-xs text-rose-100/70">
                    {recentSitrep
                      ? `${recentSitrep.reporter?.fullName ?? recentSitrep.reporterId} · ${formatTaskTimestamp(recentSitrep.reportedAt)}`
                      : "The timeline will start filling here once reporting begins."}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                    Participants
                  </p>
                  <h2 className="mt-2 text-2xl font-medium text-white">
                    Incident roster
                  </h2>
                </div>
                <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-100">
                  {workspace.participants.length}
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {workspace.participants.length > 0 ? (
                  workspace.participants.map((participant) => (
                    <div
                      key={`${participant.incidentId}-${participant.userId}`}
                      className="flex items-center justify-between gap-4 rounded-[22px] border border-white/10 bg-black/10 px-4 py-3"
                    >
                      <div>
                        <div className="text-sm font-medium text-white">
                          {participant.user?.fullName ?? participant.userId}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                          {participant.roleInIncident}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500">
                        Joined {formatTaskTimestamp(participant.joinedAt)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-black/10 px-4 py-10 text-center text-sm text-slate-500">
                    No participant data in the current feed.
                  </div>
                )}
              </div>
            </div>

            <IncidentActivityFeed
              source={workspace.source}
              incidentId={incident.id}
              timeline={workspace.timeline}
              timelinePage={workspace.timelinePage}
              sitreps={workspace.sitreps}
              sitrepPage={workspace.sitrepPage}
              users={workspace.availableUsers}
              participants={workspace.participants}
              refreshedAt={workspace.refreshedAt}
            />
          </div>

          <div className="space-y-6">
            <IncidentCommandPanel
              key={`incident-controls-${incident.id}`}
              source={workspace.source}
              incident={incident}
              availableTransitions={workspace.availableTransitions}
              availableUsers={workspace.availableUsers}
              participants={workspace.participants}
              redirectPath={`/incidents/${incident.id}?tab=overview`}
              overviewHref={`/incidents/${incident.id}?tab=overview`}
              tasksHref={taskTabBasePath}
              openTaskCount={activeTaskCount}
              overdueTaskCount={overdueTaskCount}
            />

            <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
                Task snapshot
              </p>
              <h2 className="mt-3 text-2xl font-medium text-white">
                This incident already carries its own task workspace.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Open the embedded task console tab to reorder the incident board,
                inspect selected task detail, and run task mutations without
                leaving the incident page.
              </p>

              <Link
                href={taskTabBasePath}
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
              >
                Open embedded task console <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
              <div className="flex items-center gap-3 text-cyan-100">
                <Waves className="h-5 w-5" />
                <span className="text-sm font-medium">
                  Compact incident task board
                </span>
              </div>

              <div className="mt-5">
                <TaskStatusBoard
                  key={getTaskBoardSignature(workspace.taskWorkspace.board)}
                  board={workspace.taskWorkspace.board}
                  selectedTaskId={workspace.taskWorkspace.selectedTask?.id}
                  maxPerColumn={2}
                  taskHrefBuilder={incidentTaskHref}
                />
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
              <div className="flex items-center gap-3 text-cyan-100">
                <RadioTower className="h-5 w-5" />
                <span className="text-sm font-medium">Current task focus</span>
              </div>
              <div className="mt-5">
                <TaskDetailPanel task={workspace.taskWorkspace.selectedTask} compact />
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

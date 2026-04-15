export type FrontendRealtimeEvent = {
  event: string;
  tenantId?: string | null;
  incidentId?: string | null;
  taskId?: string | null;
  actorId?: string | null;
  payload?: Record<string, unknown>;
  emittedAt?: string;
};

function stringValue(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

export function describeRealtimeEvent(event: FrontendRealtimeEvent): {
  title: string;
  description: string;
} {
  switch (event.event) {
    case "task.created":
      return {
        title: "New task created",
        description: "The board received a new task and refreshed to the latest live state.",
      };
    case "task.updated":
      return {
        title: "Task updated",
        description: "Task fields changed in the live workspace.",
      };
    case "task.position_changed":
      return {
        title: "Task reordered",
        description: "A board lane changed order and your view was resynced.",
      };
    case "task.assigned":
      return {
        title: "Task assignment changed",
        description: "An assignee update landed on the live board.",
      };
    case "task.status_changed":
      return {
        title: "Task status changed",
        description: `Task moved to ${stringValue(event.payload, "after") ?? "a new status"}.`,
      };
    case "task.completed":
      return {
        title: "Task completed",
        description: "A task reached done and the board refreshed.",
      };
    case "task.commented":
      return {
        title: "New task comment",
        description: "Discussion on a task was updated live.",
      };
    case "incident.created":
      return {
        title: "Incident created",
        description: "The incident index received a new incident.",
      };
    case "incident.status_changed":
      return {
        title: "Incident status changed",
        description: `Incident moved to ${stringValue(event.payload, "after") ?? "a new status"}.`,
      };
    case "incident.severity_changed":
      return {
        title: "Incident severity changed",
        description: "Severity was updated in the command workspace.",
      };
    case "incident.commander_assigned":
      return {
        title: "Commander reassigned",
        description: "Incident command ownership changed.",
      };
    case "incident.participant_added":
      return {
        title: "Participant added",
        description: "The incident roster was updated.",
      };
    case "incident.participant_removed":
      return {
        title: "Participant removed",
        description: "A participant left the active incident roster.",
      };
    case "incident.sitrep.submitted":
      return {
        title: "New sitrep submitted",
        description: "A fresh field report was added to the incident feed.",
      };
    case "gis.feature.created":
      return {
        title: "Map feature created",
        description: "A new GIS overlay was added to the incident map.",
      };
    case "gis.feature.updated":
      return {
        title: "Map feature updated",
        description: "A GIS overlay changed and the map refreshed.",
      };
    case "gis.feature.deleted":
      return {
        title: "Map feature deleted",
        description: "A GIS overlay was removed from the visible map.",
      };
    default:
      return {
        title: "Workspace updated",
        description: "A live event arrived and the workspace was refreshed.",
      };
  }
}

export function extractTouchedTaskIds(event: FrontendRealtimeEvent): string[] {
  return event.taskId ? [event.taskId] : [];
}

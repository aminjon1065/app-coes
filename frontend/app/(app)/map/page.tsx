import { Map } from "lucide-react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export default function MapPage() {
  return (
    <ModulePlaceholder
      eyebrow="Operational map"
      title="Map tooling is staged, but not wired yet."
      description="This route will host the live incident map, unit overlays, and task-linked geographic context. For now it stays as a navigable placeholder instead of a dead branch in the app shell."
      status="Map stack reserved"
      ctaHref="/dashboard"
      ctaLabel="Return to dashboard"
      Icon={Map}
      milestones={[
        "Base map and incident area layers with MapLibre.",
        "Task markers linked to incident sectors and assignments.",
        "Shared selection state between map, dashboard, and task detail.",
      ]}
    />
  );
}

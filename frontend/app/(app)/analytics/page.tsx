import { BarChart3 } from "lucide-react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export default function AnalyticsPage() {
  return (
    <ModulePlaceholder
      eyebrow="Operations analytics"
      title="Analytics is waiting on stabilized read models."
      description="Once the task and incident slices expose stable aggregates, this section can surface SLA pressure, queue aging, and throughput without inventing temporary contracts on the frontend."
      status="Read models pending"
      ctaHref="/tasks"
      ctaLabel="Review current board"
      Icon={BarChart3}
      milestones={[
        "Board throughput, overdue trend, and assignment load charts.",
        "Incident and operator drill-downs with reusable filters.",
        "Export-safe summary views for command reporting.",
      ]}
    />
  );
}

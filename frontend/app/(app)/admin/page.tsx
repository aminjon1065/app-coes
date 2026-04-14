import { Settings2 } from "lucide-react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export default function AdminPage() {
  return (
    <ModulePlaceholder
      eyebrow="Tenant administration"
      title="Administrative tooling is intentionally held behind the shell."
      description="The app menu already reserves space for user, role, and configuration management. This page keeps navigation coherent while the operational UI takes priority."
      status="Admin surface queued"
      ctaHref="/dashboard"
      ctaLabel="Back to command view"
      Icon={Settings2}
      milestones={[
        "User and role management with tenant scoping.",
        "Reference data and operational dictionary controls.",
        "Audit and integration settings once backend policies settle.",
      ]}
    />
  );
}

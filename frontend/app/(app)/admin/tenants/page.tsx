import { TenantCard } from "@/components/admin/tenant-card";

export default function AdminTenantsPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <TenantCard
        title="Tenant registry"
        description="Platform-level tenant lifecycle controls are reserved for a dedicated backend contract. This card marks the future surface for organization provisioning, domain mapping, and status controls."
        status="Planned"
      />
      <TenantCard
        title="Integration and policy settings"
        description="Secrets, SSO providers, retention periods, and cross-agency rules belong here once the corresponding admin APIs are exposed."
        status="Queued"
      />
    </div>
  );
}

import { RolePermissionMatrix } from "@/components/admin/role-permission-matrix";
import { TenantCard } from "@/components/admin/tenant-card";

const ROLES = [
  { code: "tenant_admin", name: "Tenant Admin", scope: "cross-domain" },
  { code: "shift_lead", name: "Shift Lead", scope: "incident" },
  { code: "incident_commander", name: "Incident Commander", scope: "incident" },
  { code: "analyst", name: "Analyst", scope: "analytics" },
];

const PERMISSIONS = [
  { code: "iam.users.read", domain: "cross-domain" },
  { code: "iam.users.create", domain: "cross-domain" },
  { code: "incident.read", domain: "incident" },
  { code: "incident.manage", domain: "incident" },
  { code: "analytics.read", domain: "analytics" },
  { code: "analytics.export", domain: "analytics" },
];

export default function AdminRolesPage() {
  return (
    <div className="space-y-6">
      <RolePermissionMatrix roles={ROLES} permissions={PERMISSIONS} />
      <TenantCard
        title="Role editing is staged behind backend REST expansion"
        description="The plan calls for a checkbox grid with PATCH support for role permissions. The current backend does not expose that contract yet, so this surface documents the intended matrix without faking writable behavior."
        status="Read-only"
      />
    </div>
  );
}

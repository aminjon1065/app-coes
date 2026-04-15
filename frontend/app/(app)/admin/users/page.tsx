import { BreakGlassPanel } from "@/components/admin/break-glass-panel";
import { UserForm } from "@/components/admin/user-form";
import { UserTable } from "@/components/admin/user-table";
import { loadAdminWorkspace } from "@/lib/api/admin-workspace";

export default async function AdminUsersPage() {
  const workspace = await loadAdminWorkspace();
  const roles = new Set(workspace.currentUser.roles);
  const permissions = new Set(workspace.currentUser.permissions ?? []);
  const canManageUsers =
    workspace.source === "api" &&
    (roles.has("platform_admin") || roles.has("tenant_admin")) &&
    permissions.has("iam.users.create") &&
    permissions.has("iam.users.delete");
  const canBreakGlass =
    workspace.source === "api" &&
    (roles.has("platform_admin") || roles.has("shift_lead"));

  return (
    <section className="grid gap-6 xl:grid-cols-[1fr_390px]">
      <UserTable
        users={workspace.users}
        disabled={!canManageUsers}
      />
      <div className="space-y-5">
        <UserForm disabled={!canManageUsers} />
        <BreakGlassPanel
          currentUser={workspace.currentUser}
          users={workspace.users}
          disabled={!canBreakGlass}
        />
        <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Current scope
          </p>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Live mode uses `/auth/me`, `/users`, and `/iam/break-glass`. If those
            endpoints are not reachable, the admin shell falls back to a seeded
            tenant snapshot and disables mutations instead of pretending writes
            succeeded.
          </p>
        </div>
      </div>
    </section>
  );
}

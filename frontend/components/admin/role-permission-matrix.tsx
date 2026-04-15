type RolePermissionMatrixProps = {
  roles: Array<{ code: string; name: string; scope: string }>;
  permissions: Array<{ code: string; domain: string }>;
};

export function RolePermissionMatrix({
  roles,
  permissions,
}: RolePermissionMatrixProps) {
  return (
    <section className="rounded-[30px] border border-white/10 bg-white/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
        Role matrix
      </p>
      <h2 className="mt-2 text-2xl font-medium text-white">
        Planned permission editor
      </h2>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Scope</th>
              <th className="px-4 py-2">Permissions</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.code} className="bg-black/15 text-sm text-slate-200">
                <td className="rounded-l-[20px] px-4 py-3">
                  <div className="font-medium text-white">{role.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{role.code}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">{role.scope}</td>
                <td className="rounded-r-[20px] px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {permissions
                      .filter((permission) => permission.domain === role.scope || role.scope === "cross-domain")
                      .slice(0, 4)
                      .map((permission) => (
                        <span
                          key={`${role.code}-${permission.code}`}
                          className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300"
                        >
                          {permission.code}
                        </span>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

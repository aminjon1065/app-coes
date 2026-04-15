import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdminAccess } from "@/lib/api/admin-workspace";

type AdminLayoutProps = {
  children: ReactNode;
};

const NAV_ITEMS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/roles", label: "Roles" },
  { href: "/admin/tenants", label: "Tenants" },
];

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const workspace = await requireAdminAccess();

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
              Admin panel
            </p>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              Tenant administration and identity operations.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              The current shell exposes live tenant user management now and reserves
              roles and tenant settings for the next backend contract expansion.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Current role
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {workspace.currentUser.roles.join(", ")}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Tenant {workspace.currentUser.tenantId}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/10"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      {children}
    </main>
  );
}

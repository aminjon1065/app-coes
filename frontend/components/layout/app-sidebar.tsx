"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  CheckSquare,
  LayoutDashboard,
  Map,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/incidents", label: "Incidents", icon: AlertTriangle },
  { href: "/map", label: "Map", icon: Map },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin", label: "Admin", icon: Settings2 },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <>
      <aside className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[rgba(11,15,24,0.92)] px-2 py-2 backdrop-blur-xl md:hidden">
        <nav className="grid grid-cols-4 gap-2">
          {navItems.slice(0, 4).map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] font-medium transition",
                  active
                    ? "bg-cyan-400/12 text-cyan-100"
                    : "text-slate-400 hover:bg-white/6 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <aside className="fixed left-0 top-20 z-30 hidden h-[calc(100vh-5rem)] w-72 border-r border-white/10 bg-[rgba(10,14,22,0.78)] px-4 py-5 backdrop-blur-xl md:block">
        <div className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.25)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-cyan-200/70">
            Active shift
          </p>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-white">Rustam Nazarov</h2>
              <p className="mt-1 text-sm text-slate-400">
                National response command, task supervision
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
              Lead
            </div>
          </div>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl border px-3 py-3 transition",
                  active
                    ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-50"
                    : "border-transparent bg-transparent text-slate-400 hover:border-white/10 hover:bg-white/6 hover:text-white",
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-2xl border transition",
                    active
                      ? "border-cyan-400/30 bg-cyan-400/12 text-cyan-100"
                      : "border-white/10 bg-white/5 text-slate-300 group-hover:border-white/15",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-slate-500">
                    {item.href === "/tasks"
                      ? "Board, queue, overdue, detail"
                      : item.href === "/dashboard"
                        ? "Priority snapshot"
                        : "Module stub"}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

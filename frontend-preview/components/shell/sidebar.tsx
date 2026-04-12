"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  AlertTriangle,
  CheckSquare,
  Map,
  FileText,
  MessageSquare,
  BarChart2,
  Settings,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: React.ElementType;
  href: string;
  badge?: number;
  active?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "OPERATIONS",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, href: "/", active: true },
      { label: "Incidents", icon: AlertTriangle, href: "/incidents", badge: 12 },
      { label: "Tasks", icon: CheckSquare, href: "/tasks", badge: 8 },
      { label: "Map", icon: Map, href: "/map" },
    ],
  },
  {
    title: "COORDINATION",
    items: [
      { label: "Documents", icon: FileText, href: "/documents" },
      { label: "Chat", icon: MessageSquare, href: "/chat", badge: 23 },
      { label: "Analytics", icon: BarChart2, href: "/analytics" },
    ],
  },
  {
    title: "SYSTEM",
    items: [
      { label: "Admin", icon: Settings, href: "/admin" },
    ],
  },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "fixed left-0 top-[48px] bottom-0 z-40 flex flex-col",
        "bg-sentinel-sidebar border-r border-sentinel-border",
        "transition-all duration-200",
        collapsed ? "w-[56px]" : "w-[240px]"
      )}
    >
      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navSections.map((section) => (
          <div key={section.title} className="mb-4">
            {!collapsed && (
              <p className="px-2 mb-1 text-2xs font-semibold tracking-widest text-sentinel-subtle uppercase">
                {section.title}
              </p>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 h-9 px-2 rounded-md mb-0.5",
                    "text-sm transition-colors",
                    item.active
                      ? "bg-sentinel-primary/10 text-sentinel-primary font-semibold"
                      : "text-sentinel-muted hover:bg-sentinel-border hover:text-sentinel-text"
                  )}
                >
                  <Icon
                    className={cn(
                      "w-4 h-4 shrink-0",
                      item.active ? "text-sentinel-primary" : "text-sentinel-subtle"
                    )}
                    strokeWidth={1.75}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge !== undefined && (
                        <span className={cn(
                          "text-2xs font-bold px-1.5 py-0.5 rounded-sm min-w-[20px] text-center",
                          item.active
                            ? "bg-sentinel-primary/20 text-sentinel-primary"
                            : "bg-sentinel-border text-sentinel-muted"
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                  {collapsed && item.badge !== undefined && (
                    <span className="absolute left-8 top-0 w-3.5 h-3.5 flex items-center justify-center text-2xs font-bold bg-sentinel-primary text-white rounded-sm">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom: user info + collapse button */}
      <div className="border-t border-sentinel-border p-2">
        {!collapsed && (
          <div className="flex items-center gap-2 px-2 py-2 mb-1">
            <div className="w-6 h-6 rounded-sm bg-sentinel-primary flex items-center justify-center text-2xs font-bold text-white shrink-0">
              AD
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-sentinel-text truncate">A. Dzhaksybekov</p>
              <p className="text-2xs text-sentinel-subtle truncate">Shift Supervisor</p>
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center h-8 rounded-md hover:bg-sentinel-border transition-colors text-sentinel-subtle hover:text-sentinel-muted"
        >
          <ChevronLeft
            className={cn(
              "w-4 h-4 transition-transform",
              collapsed && "rotate-180"
            )}
          />
          {!collapsed && <span className="ml-1.5 text-xs">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

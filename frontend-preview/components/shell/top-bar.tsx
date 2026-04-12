"use client";

import { useState } from "react";
import { Shield, Search, Bell, ChevronDown, User, Settings, LogOut, Command } from "lucide-react";
import { cn } from "@/lib/utils";

export function TopBar() {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[48px] flex items-center px-4 gap-4 border-b border-sentinel-border bg-sentinel-sidebar">
      {/* Left: Logo + Tenant */}
      <div className="flex items-center gap-3 w-[240px] shrink-0">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-sentinel-primary" strokeWidth={2} />
          <span className="text-sm font-bold tracking-widest text-sentinel-text uppercase">
            Sentinel
          </span>
        </div>
        <div className="h-4 w-px bg-sentinel-border" />
        <span className="text-xs font-mono text-sentinel-subtle bg-sentinel-border px-2 py-0.5 rounded-sm">
          TJ · Dushanbe HQ
        </span>
      </div>

      {/* Center: Search */}
      <div className="flex-1 max-w-lg mx-auto">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sentinel-subtle"
            strokeWidth={2}
          />
          <input
            type="text"
            placeholder="Search incidents, tasks…"
            className={cn(
              "w-full h-8 pl-9 pr-12 text-sm rounded-md",
              "bg-sentinel-bg border border-sentinel-border",
              "text-sentinel-text placeholder:text-sentinel-subtle",
              "focus:outline-none focus:border-sentinel-primary focus:ring-1 focus:ring-sentinel-primary/30",
              "transition-colors"
            )}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <kbd className="flex items-center gap-0.5 text-2xs font-mono text-sentinel-subtle bg-sentinel-border px-1 py-0.5 rounded-sm">
              <Command className="w-2.5 h-2.5" />K
            </kbd>
          </div>
        </div>
      </div>

      {/* Right: Status + Bell + User */}
      <div className="flex items-center gap-3 ml-auto">
        {/* System status */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-severity-1 opacity-50" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-severity-1" />
          </span>
          <span className="text-severity-1 font-medium hidden sm:block">All systems operational</span>
        </div>

        <div className="h-4 w-px bg-sentinel-border" />

        {/* Bell */}
        <button className="relative p-1.5 rounded-md hover:bg-sentinel-border transition-colors">
          <Bell className="w-4 h-4 text-sentinel-muted" />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center text-2xs font-bold bg-severity-4 text-white rounded-sm">
            3
          </span>
        </button>

        {/* User avatar + dropdown */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className={cn(
              "flex items-center gap-2 h-8 pl-1 pr-2 rounded-md",
              "hover:bg-sentinel-border transition-colors",
              userMenuOpen && "bg-sentinel-border"
            )}
          >
            <div className="w-6 h-6 rounded-sm bg-sentinel-primary flex items-center justify-center text-2xs font-bold text-white">
              RN
            </div>
            <ChevronDown
              className={cn(
                "w-3 h-3 text-sentinel-subtle transition-transform",
                userMenuOpen && "rotate-180"
              )}
            />
          </button>

          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setUserMenuOpen(false)}
              />
              <div className={cn(
                "absolute right-0 top-full mt-1 w-52 z-50",
                "bg-sentinel-sidebar border border-sentinel-border rounded-md shadow-xl",
                "py-1"
              )}>
                {/* User info */}
                <div className="px-3 py-2 border-b border-sentinel-border">
                  <p className="text-sm font-medium text-sentinel-text">R. Nazarov</p>
                  <p className="text-xs text-sentinel-muted mt-0.5">Shift Supervisor</p>
                </div>
                {/* Menu items */}
                <div className="py-1">
                  <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-sentinel-muted hover:bg-sentinel-border hover:text-sentinel-text transition-colors">
                    <User className="w-3.5 h-3.5" />
                    Profile
                  </button>
                  <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-sentinel-muted hover:bg-sentinel-border hover:text-sentinel-text transition-colors">
                    <Settings className="w-3.5 h-3.5" />
                    Settings
                  </button>
                </div>
                <div className="border-t border-sentinel-border py-1">
                  <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-severity-4 hover:bg-severity-bg-4 transition-colors">
                    <LogOut className="w-3.5 h-3.5" />
                    Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

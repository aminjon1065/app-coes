import type { ReactNode } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-[-8rem] h-80 w-80 rounded-full bg-[radial-gradient(circle,_rgba(74,208,255,0.18),_transparent_65%)] blur-3xl" />
        <div className="absolute right-[-8rem] top-28 h-96 w-96 rounded-full bg-[radial-gradient(circle,_rgba(255,122,89,0.16),_transparent_68%)] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:32px_32px] opacity-25" />
      </div>

      <AppTopbar />
      <AppSidebar />

      <div className="relative min-h-screen pt-20 pb-24 md:pb-8 md:pl-72">
        <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-[1600px] flex-col px-4 md:px-6">
          {children}
        </div>
      </div>
    </div>
  );
}

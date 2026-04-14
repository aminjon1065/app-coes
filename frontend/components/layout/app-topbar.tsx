import { format } from "date-fns";
import { BellDot, ShieldCheck, Sparkles } from "lucide-react";

export function AppTopbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[rgba(9,13,21,0.72)] backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]">
            <ShieldCheck className="h-6 w-6 text-cyan-300" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-cyan-200/70">
              CoESCD Task Console
            </p>
            <h1 className="truncate font-sans text-lg font-medium text-white md:text-xl">
              Operational task board and command queue
            </h1>
          </div>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-100">
            Link status: monitored
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200">
            {format(new Date(), "EEE dd MMM yyyy · HH:mm")}
          </div>
          <button className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10">
            <BellDot className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
            Live
          </div>
          <Sparkles className="h-5 w-5 text-cyan-200" />
        </div>
      </div>
    </header>
  );
}

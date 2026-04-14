import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

type ModulePlaceholderProps = {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  ctaHref: string;
  ctaLabel: string;
  Icon: LucideIcon;
  milestones: string[];
};

export function ModulePlaceholder({
  eyebrow,
  title,
  description,
  status,
  ctaHref,
  ctaLabel,
  Icon,
  milestones,
}: ModulePlaceholderProps) {
  return (
    <main className="space-y-6 pb-8">
      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.92),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
                {title}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                {description}
              </p>
            </div>

            <div className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-[24px] border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 md:flex">
              <Icon className="h-7 w-7" />
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16"
            >
              {ctaLabel} <ArrowRight className="h-4 w-4" />
            </Link>
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-300">
              {status}
            </div>
          </div>
        </div>

        <aside className="rounded-[34px] border border-white/10 bg-white/5 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.18)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-slate-500">
            Next build targets
          </p>
          <div className="mt-5 space-y-3">
            {milestones.map((item, index) => (
              <div
                key={item}
                className="rounded-[24px] border border-white/10 bg-black/10 p-4"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">
                  Step {index + 1}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-200">{item}</div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

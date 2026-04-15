type TenantCardProps = {
  title: string;
  description: string;
  status: string;
};

export function TenantCard({ title, description, status }: TenantCardProps) {
  return (
    <article className="rounded-[26px] border border-white/10 bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-white">{title}</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">{description}</p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {status}
        </div>
      </div>
    </article>
  );
}

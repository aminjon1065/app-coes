import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  MapPinned,
  RadioTower,
} from "lucide-react";
import { SitrepForm } from "@/components/incident/sitrep-form";
import {
  INCIDENT_SORT_OPTIONS,
  loadIncidentDirectory,
  loadIncidentWorkspace,
} from "@/lib/api/incident-workspace";

type MobileSitrepPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MobileSitrepPage({
  searchParams,
}: MobileSitrepPageProps) {
  const resolvedSearchParams = await searchParams;
  const incidentId = firstParam(resolvedSearchParams.incidentId) ?? "";
  const directory = await loadIncidentDirectory({
    sort: INCIDENT_SORT_OPTIONS[1]?.value,
  });
  const workspace = incidentId
    ? await loadIncidentWorkspace({ incidentId })
    : null;
  const incident = workspace?.incident ?? null;
  const mobileWorkspace = incident && workspace ? workspace : null;

  return (
    <main className="space-y-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={incident ? `/m/incidents/${incident.id}` : "/m"}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        {incident ? (
          <div className="rounded-full border border-cyan-300/30 bg-cyan-300/12 px-3 py-2 text-xs text-cyan-50">
            {incident.code}
          </div>
        ) : null}
      </div>

      <section className="rounded-[28px] border border-white/10 bg-white/6 p-5">
        <div className="flex items-center gap-3 text-cyan-100">
          <Camera className="h-5 w-5" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Camera-first sitrep
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-medium leading-tight text-white">
          Push a field report with location and evidence.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Use current coordinates, attach one image at a time, and keep the
          report short enough for low-connectivity conditions.
        </p>
      </section>

      {!mobileWorkspace || !incident ? (
        <section className="rounded-[28px] border border-white/10 bg-black/18 p-4">
          <div className="flex items-center gap-2 text-cyan-100">
            <RadioTower className="h-4 w-4" />
            <span className="text-sm font-medium">Choose incident scope</span>
          </div>
          <div className="mt-4 space-y-3">
            {directory.incidents.slice(0, 8).map((item) => (
              <Link
                key={item.id}
                href={`/m/sitrep/new?incidentId=${item.id}`}
                className="block rounded-[22px] border border-white/10 bg-white/5 p-4"
              >
                <div className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">
                  {item.code}
                </div>
                <div className="mt-2 text-sm font-medium text-white">
                  {item.title}
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  {item.status} · severity {item.severity}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-[28px] border border-white/10 bg-black/18 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Selected incident
            </div>
            <h2 className="mt-2 text-xl font-medium text-white">
              {incident.title}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200">
                {incident.status}
              </span>
              <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-100">
                Severity {incident.severity}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200">
                <MapPinned className="h-3.5 w-3.5" />
                Location optional
              </span>
            </div>
          </section>

          <SitrepForm
            incidentId={incident.id}
            source={mobileWorkspace.source}
            redirectPath={`/m/incidents/${incident.id}`}
          />
        </>
      )}
    </main>
  );
}

import { Layers3, MapPinned, RadioTower } from "lucide-react";
import { MapWorkspaceShell } from "@/components/gis/map-workspace-shell";
import { loadGisWorkspace } from "@/lib/api/gis-workspace";

type MapPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MapPage({ searchParams }: MapPageProps) {
  const resolvedSearchParams = await searchParams;
  const incidentId = firstParam(resolvedSearchParams.incidentId);
  const workspace = await loadGisWorkspace({ incidentId });

  return (
    <main className="space-y-6 pb-8">
      <section className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 text-cyan-100">
              <MapPinned className="h-5 w-5" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/70">
                GIS workspace
              </p>
            </div>
            <h1 className="mt-3 text-3xl font-medium leading-tight text-white md:text-4xl">
              Live operational map for incidents, resources and routes.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              MapLibre renders incident geofences, resource markers, evacuation routes and
              a local draw layer while incident-scoped SSE keeps GIS overlays fresh.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3">
              <div className="flex items-center gap-2 text-cyan-100">
                <Layers3 className="h-4 w-4" />
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Layers
                </span>
              </div>
              <div className="mt-2 text-sm font-medium text-white">
                {workspace.layers.length} overlays
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {workspace.source === "api" ? "Live GIS API" : "Mock fallback"}
              </div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3">
              <div className="flex items-center gap-2 text-cyan-100">
                <RadioTower className="h-4 w-4" />
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Features
                </span>
              </div>
              <div className="mt-2 text-sm font-medium text-white">
                {workspace.features.features.length} loaded
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Center {workspace.center.map((value) => value.toFixed(3)).join(", ")}
              </div>
            </div>
          </div>
        </div>
      </section>

      <MapWorkspaceShell initialWorkspace={workspace} />
    </main>
  );
}

"use client";

import { ShieldAlert } from "lucide-react";
import type { GisFeature } from "@/lib/api/gis-workspace";

export function IncidentGeofence({ features }: { features: GisFeature[] }) {
  const geofences = features.filter(
    (feature) =>
      feature.properties.layerKind === "INCIDENT" ||
      feature.geometry.type === "Polygon" ||
      feature.geometry.type === "MultiPolygon",
  );

  return (
    <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(58,24,13,0.78),rgba(33,14,14,0.7))] p-5">
      <div className="flex items-center gap-3 text-rose-100">
        <ShieldAlert className="h-5 w-5" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-rose-100/70">
          Incident geofence
        </p>
      </div>
      <div className="mt-3 text-2xl font-medium text-white">{geofences.length}</div>
      <p className="mt-2 text-sm leading-6 text-rose-50/75">
        Active polygon overlays tied to the selected incident context.
      </p>
    </div>
  );
}

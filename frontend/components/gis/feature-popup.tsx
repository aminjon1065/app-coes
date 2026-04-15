"use client";

import { ExternalLink, MapPin, X } from "lucide-react";
import type { GisFeature } from "@/lib/api/gis-workspace";

export function FeaturePopup({
  feature,
  onClose,
}: {
  feature: GisFeature | null;
  onClose: () => void;
}) {
  if (!feature) {
    return null;
  }

  const label =
    feature.properties.label ??
    feature.properties.layerName ??
    `Feature ${feature.id.slice(0, 8)}`;

  return (
    <div className="absolute bottom-5 left-5 z-20 w-[min(360px,calc(100%-2.5rem))] rounded-[28px] border border-white/10 bg-slate-950/92 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.36)] backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 text-cyan-100">
          <MapPin className="h-5 w-5" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-200/70">
            Map feature
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <h3 className="mt-3 text-lg font-medium text-white">{String(label)}</h3>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Layer</dt>
          <dd className="text-right text-slate-200">
            {String(feature.properties.layerName ?? "Unknown")}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Kind</dt>
          <dd className="text-right text-slate-200">
            {String(feature.properties.layerKind ?? "Feature")}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Geometry</dt>
          <dd className="text-right text-slate-200">{feature.geometry.type}</dd>
        </div>
      </dl>

      {feature.properties.linkedIncidentId || feature.properties.linkedTaskId ? (
        <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs leading-5 text-cyan-50">
          {feature.properties.linkedIncidentId ? (
            <div>Incident: {feature.properties.linkedIncidentId}</div>
          ) : null}
          {feature.properties.linkedTaskId ? (
            <div className="flex items-center gap-1">
              Task: {feature.properties.linkedTaskId}
              <ExternalLink className="h-3 w-3" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

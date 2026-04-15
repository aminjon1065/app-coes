"use client";

import { Eye, EyeOff, SlidersHorizontal } from "lucide-react";
import type { GisLayer } from "@/lib/api/gis-workspace";
import { cn } from "@/lib/utils";

const KIND_COLORS: Record<string, string> = {
  INCIDENT: "bg-rose-300",
  HAZARD: "bg-orange-300",
  RESOURCE: "bg-emerald-300",
  ROUTE: "bg-cyan-300",
  DRAW: "bg-amber-300",
  BASE: "bg-slate-300",
};

export function LayerPanel({
  layers,
  visibleLayerIds,
  opacity,
  onToggleLayer,
  onOpacityChange,
}: {
  layers: GisLayer[];
  visibleLayerIds: string[];
  opacity: number;
  onToggleLayer: (layerId: string) => void;
  onOpacityChange: (opacity: number) => void;
}) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Layers
          </p>
          <h2 className="mt-2 text-xl font-medium text-white">Operational overlays</h2>
        </div>
        <SlidersHorizontal className="h-5 w-5 text-cyan-100" />
      </div>

      <div className="mt-5 space-y-3">
        {layers.map((layer) => {
          const visible = visibleLayerIds.includes(layer.id);

          return (
            <button
              key={layer.id}
              type="button"
              onClick={() => onToggleLayer(layer.id)}
              className={cn(
                "w-full rounded-[22px] border p-4 text-left transition",
                visible
                  ? "border-cyan-300/30 bg-cyan-300/10"
                  : "border-white/10 bg-black/10 hover:bg-white/8",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                      KIND_COLORS[layer.kind] ?? "bg-slate-300",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {layer.name}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                      {layer.kind}
                    </div>
                  </div>
                </div>
                {visible ? (
                  <Eye className="h-4 w-4 text-cyan-100" />
                ) : (
                  <EyeOff className="h-4 w-4 text-slate-500" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      <label className="mt-5 block">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="uppercase tracking-[0.22em] text-slate-500">Opacity</span>
          <span className="text-slate-300">{Math.round(opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min="20"
          max="100"
          value={Math.round(opacity * 100)}
          onChange={(event) => onOpacityChange(Number(event.target.value) / 100)}
          className="mt-3 w-full accent-cyan-300"
        />
      </label>
    </div>
  );
}

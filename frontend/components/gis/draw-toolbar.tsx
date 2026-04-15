"use client";

import { CircleDot, Eraser, MapPinned, Route } from "lucide-react";
import type { GisFeature } from "@/lib/api/gis-workspace";
import { cn } from "@/lib/utils";

type DrawMode = "point" | "line" | "polygon";

const MODES: Array<{
  mode: DrawMode;
  label: string;
  Icon: typeof MapPinned;
}> = [
  { mode: "point", label: "Point", Icon: MapPinned },
  { mode: "line", label: "Line", Icon: Route },
  { mode: "polygon", label: "Area", Icon: CircleDot },
];

export function createDraftFeature(mode: DrawMode, center: [number, number]): GisFeature {
  const id = `draft-${mode}-${Date.now()}`;
  const [lng, lat] = center;

  if (mode === "line") {
    return {
      type: "Feature",
      id,
      geometry: {
        type: "LineString",
        coordinates: [
          [lng - 0.03, lat - 0.015],
          [lng + 0.035, lat + 0.018],
        ],
      },
      properties: {
        label: "Draft line",
        layerId: "draw-layer",
        layerName: "Draw layer",
        layerKind: "DRAW",
      },
    };
  }

  if (mode === "polygon") {
    return {
      type: "Feature",
      id,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lng - 0.035, lat + 0.025],
            [lng + 0.04, lat + 0.02],
            [lng + 0.032, lat - 0.03],
            [lng - 0.028, lat - 0.026],
            [lng - 0.035, lat + 0.025],
          ],
        ],
      },
      properties: {
        label: "Draft polygon",
        layerId: "draw-layer",
        layerName: "Draw layer",
        layerKind: "DRAW",
      },
    };
  }

  return {
    type: "Feature",
    id,
    geometry: {
      type: "Point",
      coordinates: center,
    },
    properties: {
      label: "Draft point",
      layerId: "draw-layer",
      layerName: "Draw layer",
      layerKind: "DRAW",
    },
  };
}

export function DrawToolbar({
  activeMode,
  drawCount,
  onSelectMode,
  onAddDraft,
  onClearDrafts,
}: {
  activeMode: DrawMode;
  drawCount: number;
  onSelectMode: (mode: DrawMode) => void;
  onAddDraft: () => void;
  onClearDrafts: () => void;
}) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-100/70">
        Draw layer
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Local-only drafting for quick sketching before backend feature creation.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {MODES.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onSelectMode(mode)}
            className={cn(
              "rounded-2xl border px-3 py-2 text-xs font-medium transition",
              activeMode === mode
                ? "border-amber-300/35 bg-amber-300/12 text-amber-50"
                : "border-white/10 bg-black/10 text-slate-400 hover:bg-white/8",
            )}
          >
            <Icon className="mx-auto mb-1 h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onAddDraft}
          className="flex-1 rounded-2xl border border-amber-300/30 bg-amber-300/12 px-3 py-2 text-sm font-medium text-amber-50 hover:bg-amber-300/18"
        >
          Add draft
        </button>
        <button
          type="button"
          onClick={onClearDrafts}
          disabled={drawCount === 0}
          className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Eraser className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 text-xs text-slate-500">{drawCount} draft features</div>
    </div>
  );
}

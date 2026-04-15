"use client";

import dynamic from "next/dynamic";
import { useEffect, useEffectEvent, useMemo, useState, startTransition } from "react";
import { RefreshCw, RadioTower } from "lucide-react";
import { toast } from "sonner";
import { DrawToolbar, createDraftFeature } from "@/components/gis/draw-toolbar";
import { FeaturePopup } from "@/components/gis/feature-popup";
import { IncidentGeofence } from "@/components/gis/incident-geofence";
import { LayerPanel } from "@/components/gis/layer-panel";
import {
  type GisFeature,
  type GisFeatureCollection,
  type GisWorkspace,
} from "@/lib/api/gis-workspace";
import type { FrontendRealtimeEvent } from "@/lib/realtime";
import { cn } from "@/lib/utils";

const MapCanvas = dynamic(
  () => import("@/components/gis/map-canvas").then((module) => module.MapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[620px] items-center justify-center rounded-[34px] border border-white/10 bg-slate-950 text-sm text-slate-500">
        Loading MapLibre canvas...
      </div>
    ),
  },
);

type GisWorkspaceRefreshResponse = {
  data: GisWorkspace;
  fetchedAt: string;
};

async function requestGisWorkspace(incidentId: string | null) {
  const searchParams = new URLSearchParams();

  if (incidentId) {
    searchParams.set("incidentId", incidentId);
  }

  const response = await fetch(
    `/api/gis/workspace${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
    { cache: "no-store" },
  );
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error("GIS workspace refresh failed.");
  }

  return body as GisWorkspaceRefreshResponse;
}

function mergeFeatureCollections(
  base: GisFeatureCollection,
  drawFeatures: GisFeature[],
  visibleLayerIds: string[],
) {
  return {
    type: "FeatureCollection" as const,
    features: [...base.features, ...drawFeatures].filter((feature) => {
      const layerId = feature.properties.layerId;
      return typeof layerId !== "string" || visibleLayerIds.includes(layerId);
    }),
  };
}

function extractTouchedFeatureId(event: FrontendRealtimeEvent) {
  const payloadFeatureId = event.payload?.featureId;
  return typeof payloadFeatureId === "string" ? payloadFeatureId : null;
}

export function MapWorkspaceShell({
  initialWorkspace,
}: {
  initialWorkspace: GisWorkspace;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [visibleLayerIds, setVisibleLayerIds] = useState(
    initialWorkspace.layers.map((layer) => layer.id),
  );
  const [opacity, setOpacity] = useState(0.88);
  const [drawMode, setDrawMode] = useState<"point" | "line" | "polygon">("point");
  const [drawFeatures, setDrawFeatures] = useState<GisFeature[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<GisFeature | null>(null);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "offline">(
    initialWorkspace.source === "api" && initialWorkspace.incidentId
      ? "connecting"
      : "offline",
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [highlightedFeatureId, setHighlightedFeatureId] = useState<string | null>(null);
  const canStream = workspace.source === "api" && Boolean(workspace.incidentId);
  const visibleFeatures = useMemo(
    () => mergeFeatureCollections(workspace.features, drawFeatures, visibleLayerIds),
    [drawFeatures, visibleLayerIds, workspace.features],
  );

  useEffect(() => {
    setWorkspace(initialWorkspace);
    setVisibleLayerIds(initialWorkspace.layers.map((layer) => layer.id));
    setDrawFeatures([]);
    setSelectedFeature(null);
    setStreamState(
      initialWorkspace.source === "api" && initialWorkspace.incidentId
        ? "connecting"
        : "offline",
    );
  }, [initialWorkspace]);

  async function refreshWorkspace(manual = false) {
    if (workspace.source !== "api") {
      return;
    }

    setIsRefreshing(true);

    try {
      const payload = await requestGisWorkspace(workspace.incidentId);

      startTransition(() => {
        setWorkspace(payload.data);
        setVisibleLayerIds((current) => {
          const known = new Set(current);
          return [
            ...current.filter((id) => payload.data.layers.some((layer) => layer.id === id)),
            ...payload.data.layers
              .filter((layer) => !known.has(layer.id))
              .map((layer) => layer.id),
          ];
        });
        setStreamState(canStream ? "live" : "offline");
      });

      if (manual) {
        toast("Map refreshed", {
          description: "GIS layers and feature collections were reloaded.",
        });
      }
    } catch (error) {
      setStreamState("offline");
      toast("Map refresh failed", {
        description:
          error instanceof Error
            ? error.message
            : "GIS workspace refresh failed unexpectedly.",
      });
    } finally {
      setIsRefreshing(false);
    }
  }

  const handleLiveRefresh = useEffectEvent(async (event: FrontendRealtimeEvent) => {
    const featureId = extractTouchedFeatureId(event);

    if (featureId) {
      setHighlightedFeatureId(featureId);
      window.setTimeout(() => setHighlightedFeatureId(null), 2600);
    }

    if (event.event.startsWith("gis.feature.")) {
      toast("Map feature updated", {
        description: "GIS overlays were refreshed from the incident stream.",
      });
    }

    if (workspace.source !== "api") {
      return;
    }

    try {
      const payload = await requestGisWorkspace(workspace.incidentId);

      startTransition(() => {
        setWorkspace(payload.data);
        setVisibleLayerIds((current) => {
          const known = new Set(current);
          return [
            ...current.filter((id) => payload.data.layers.some((layer) => layer.id === id)),
            ...payload.data.layers
              .filter((layer) => !known.has(layer.id))
              .map((layer) => layer.id),
          ];
        });
        setStreamState(payload.data.source === "api" && payload.data.incidentId ? "live" : "offline");
      });
    } catch {
      setStreamState("offline");
    }
  });

  useEffect(() => {
    if (!canStream || !workspace.incidentId) {
      return;
    }

    setStreamState("connecting");
    const eventSource = new EventSource(`/api/incidents/${workspace.incidentId}/stream`);

    eventSource.onopen = () => {
      setStreamState("live");
    };
    eventSource.onerror = () => {
      setStreamState("offline");
    };
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as FrontendRealtimeEvent;

        if (payload.event === "heartbeat") {
          return;
        }

        if (payload.event.startsWith("gis.")) {
          void handleLiveRefresh(payload);
        }
      } catch {
        void handleLiveRefresh({
          event: "gis.feature.updated",
          incidentId: workspace.incidentId,
          payload: {},
        });
      }
    };

    return () => {
      eventSource.close();
    };
  }, [canStream, workspace.incidentId]);

  const activeFeatureCount = visibleFeatures.features.length;

  return (
    <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <aside className="space-y-5">
        <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
                Map feed
              </p>
              <h2 className="mt-2 text-xl font-medium text-white">
                {workspace.source === "api" ? "Live GIS API" : "Mock fallback"}
              </h2>
            </div>
            <div
              className={cn(
                "rounded-2xl border px-3 py-2 text-xs font-medium uppercase tracking-[0.2em]",
                streamState === "live"
                  ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                  : streamState === "connecting"
                    ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                    : "border-white/10 bg-black/10 text-slate-500",
              )}
            >
              {streamState}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshWorkspace(true)}
            disabled={workspace.source !== "api" || isRefreshing}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            Refresh overlays
          </button>
        </div>

        <LayerPanel
          layers={workspace.layers}
          visibleLayerIds={visibleLayerIds}
          opacity={opacity}
          onToggleLayer={(layerId) =>
            setVisibleLayerIds((current) =>
              current.includes(layerId)
                ? current.filter((id) => id !== layerId)
                : [...current, layerId],
            )
          }
          onOpacityChange={setOpacity}
        />

        <DrawToolbar
          activeMode={drawMode}
          drawCount={drawFeatures.length}
          onSelectMode={setDrawMode}
          onAddDraft={() =>
            setDrawFeatures((current) => [
              ...current,
              createDraftFeature(drawMode, workspace.center),
            ])
          }
          onClearDrafts={() => setDrawFeatures([])}
        />

        <IncidentGeofence features={workspace.features.features} />
      </aside>

      <div className="space-y-4">
        <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(10,16,28,0.94),rgba(17,26,42,0.86))] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
            <div>
              <div className="flex items-center gap-2 text-cyan-100">
                <RadioTower className="h-4 w-4" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
                  Live map canvas
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-medium text-white">
                {activeFeatureCount} visible features
              </h2>
            </div>
            {highlightedFeatureId ? (
              <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                Updated feature {highlightedFeatureId.slice(0, 8)}
              </div>
            ) : null}
          </div>

          <div className="relative">
            <MapCanvas
              features={visibleFeatures}
              center={workspace.center}
              zoom={workspace.zoom}
              opacity={opacity}
              onFeatureClick={setSelectedFeature}
            />
            <FeaturePopup feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
          </div>
        </div>
      </div>
    </section>
  );
}

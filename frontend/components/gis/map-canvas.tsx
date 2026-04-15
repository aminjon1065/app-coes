"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GisFeature, GisFeatureCollection } from "@/lib/api/gis-workspace";

type MapCanvasProps = {
  features: GisFeatureCollection;
  center: [number, number];
  zoom: number;
  opacity: number;
  onFeatureClick: (feature: GisFeature) => void;
};

const EMPTY_COLLECTION: GisFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function asMapData(collection: GisFeatureCollection) {
  return collection as unknown as GeoJSON.FeatureCollection;
}

export function MapCanvas({
  features,
  center,
  zoom,
  opacity,
  onFeatureClick,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onFeatureClickRef = useRef(onFeatureClick);
  const initialFeaturesRef = useRef(features);
  const initialCenterRef = useRef(center);
  const initialZoomRef = useRef(zoom);
  const initialOpacityRef = useRef(opacity);

  useEffect(() => {
    onFeatureClickRef.current = onFeatureClick;
  }, [onFeatureClick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: initialCenterRef.current,
      zoom: initialZoomRef.current,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("features", {
        type: "geojson",
        data: asMapData(initialFeaturesRef.current),
        promoteId: "id",
      });

      map.addLayer({
        id: "features-polygons-fill",
        type: "fill",
        source: "features",
        filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        paint: {
          "fill-color": [
            "match",
            ["get", "layerKind"],
            "INCIDENT",
            "#fb7185",
            "HAZARD",
            "#fb923c",
            "DRAW",
            "#facc15",
            "#38bdf8",
          ],
          "fill-opacity": initialOpacityRef.current * 0.26,
        },
      });

      map.addLayer({
        id: "features-polygons-line",
        type: "line",
        source: "features",
        filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        paint: {
          "line-color": "#fda4af",
          "line-width": 2,
          "line-opacity": initialOpacityRef.current,
        },
      });

      map.addLayer({
        id: "features-lines",
        type: "line",
        source: "features",
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        paint: {
          "line-color": [
            "match",
            ["get", "layerKind"],
            "ROUTE",
            "#22d3ee",
            "DRAW",
            "#facc15",
            "#93c5fd",
          ],
          "line-width": 4,
          "line-opacity": initialOpacityRef.current,
        },
      });

      map.addLayer({
        id: "features-points",
        type: "circle",
        source: "features",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": [
            "match",
            ["get", "layerKind"],
            "RESOURCE",
            "#34d399",
            "DRAW",
            "#facc15",
            "#67e8f9",
          ],
          "circle-radius": 8,
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 2,
          "circle-opacity": initialOpacityRef.current,
        },
      });

      map.addLayer({
        id: "features-labels",
        type: "symbol",
        source: "features",
        layout: {
          "text-field": ["coalesce", ["get", "label"], ["get", "layerName"], ""],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#e0f2fe",
          "text-halo-color": "#020617",
          "text-halo-width": 1.4,
          "text-opacity": initialOpacityRef.current,
        },
      });

      for (const layerId of [
        "features-points",
        "features-lines",
        "features-polygons-fill",
        "features-polygons-line",
      ]) {
        map.on("click", layerId, (event) => {
          const feature = event.features?.[0];

          if (!feature?.id) {
            return;
          }

          onFeatureClickRef.current({
            type: "Feature",
            id: String(feature.id),
            geometry: feature.geometry as unknown as GisFeature["geometry"],
            properties: feature.properties as GisFeature["properties"],
          });
        });
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("features") as maplibregl.GeoJSONSource | undefined;

    if (!map || !source) {
      return;
    }

    source.setData(asMapData(features));
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map?.isStyleLoaded()) {
      return;
    }

    if (map.getLayer("features-polygons-fill")) {
      map.setPaintProperty("features-polygons-fill", "fill-opacity", opacity * 0.26);
    }
    if (map.getLayer("features-polygons-line")) {
      map.setPaintProperty("features-polygons-line", "line-opacity", opacity);
    }
    if (map.getLayer("features-lines")) {
      map.setPaintProperty("features-lines", "line-opacity", opacity);
    }
    if (map.getLayer("features-points")) {
      map.setPaintProperty("features-points", "circle-opacity", opacity);
    }
    if (map.getLayer("features-labels")) {
      map.setPaintProperty("features-labels", "text-opacity", opacity);
    }
  }, [opacity]);

  return (
    <div className="relative h-full min-h-[620px] overflow-hidden rounded-[34px] border border-white/10 bg-slate-950">
      <div ref={containerRef} className="h-full min-h-[620px] w-full" />
      {features.features.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-6 top-6 rounded-[24px] border border-white/10 bg-slate-950/84 px-4 py-3 text-sm text-slate-300 backdrop-blur">
          No GIS features are visible for the current filters.
        </div>
      ) : null}
    </div>
  );
}

export { EMPTY_COLLECTION };

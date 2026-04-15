export type GisLayerKind = "BASE" | "HAZARD" | "RESOURCE" | "ROUTE" | "INCIDENT" | "DRAW";

export type GisGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: GisGeometry[];
};

export type GisFeature = {
  type: "Feature";
  id: string;
  geometry: GisGeometry;
  properties: {
    label?: string | null;
    linkedIncidentId?: string | null;
    linkedTaskId?: string | null;
    layerId?: string;
    layerName?: string;
    layerKind?: GisLayerKind;
    [key: string]: unknown;
  };
};

export type GisFeatureCollection = {
  type: "FeatureCollection";
  features: GisFeature[];
};

export type GisLayer = {
  id: string;
  tenantId?: string;
  incidentId: string | null;
  kind: GisLayerKind;
  name: string;
  description: string | null;
  style: Record<string, unknown>;
  isPublic: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type GisWorkspace = {
  source: "api" | "mock";
  layers: GisLayer[];
  features: GisFeatureCollection;
  center: [number, number];
  zoom: number;
  incidentId: string | null;
  refreshedAt: string;
};

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const API_TOKEN =
  process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

async function fetchGisApi<T>(path: string): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) {
    throw new Error(`GIS request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function query(params: Record<string, string | null | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const value = searchParams.toString();
  return value ? `?${value}` : "";
}

function mockWorkspace(incidentId?: string | null): GisWorkspace {
  const now = new Date().toISOString();
  const layers: GisLayer[] = [
    {
      id: "mock-incident-layer",
      incidentId: incidentId ?? null,
      kind: "INCIDENT",
      name: "Incident geofence",
      description: "Mock incident perimeter.",
      style: {},
      isPublic: true,
      createdBy: "mock-system",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "mock-resource-layer",
      incidentId: null,
      kind: "RESOURCE",
      name: "Response resources",
      description: "Mock staging and medical resources.",
      style: {},
      isPublic: true,
      createdBy: "mock-system",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "mock-route-layer",
      incidentId: null,
      kind: "ROUTE",
      name: "Evacuation routes",
      description: "Mock outbound corridor.",
      style: {},
      isPublic: true,
      createdBy: "mock-system",
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    source: "mock",
    layers,
    incidentId: incidentId ?? null,
    center: [68.7864, 38.5598],
    zoom: 10,
    refreshedAt: now,
    features: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "mock-geofence",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [68.7101, 38.602],
                [68.865, 38.609],
                [68.883, 38.515],
                [68.735, 38.498],
                [68.7101, 38.602],
              ],
            ],
          },
          properties: {
            label: "Mock incident perimeter",
            layerId: "mock-incident-layer",
            layerName: "Incident geofence",
            layerKind: "INCIDENT",
            linkedIncidentId: incidentId ?? null,
          },
        },
        {
          type: "Feature",
          id: "mock-field-hospital",
          geometry: { type: "Point", coordinates: [68.793, 38.566] },
          properties: {
            label: "Field hospital alpha",
            layerId: "mock-resource-layer",
            layerName: "Response resources",
            layerKind: "RESOURCE",
          },
        },
        {
          type: "Feature",
          id: "mock-route",
          geometry: {
            type: "LineString",
            coordinates: [
              [68.765, 38.58],
              [68.82, 38.55],
              [68.91, 38.53],
            ],
          },
          properties: {
            label: "Evacuation route east",
            layerId: "mock-route-layer",
            layerName: "Evacuation routes",
            layerKind: "ROUTE",
          },
        },
      ],
    },
  };
}

function getPointCoordinate(geometry: GisGeometry): [number, number] | null {
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const [lng, lat] = geometry.coordinates;
    return typeof lng === "number" && typeof lat === "number" ? [lng, lat] : null;
  }

  if (Array.isArray(geometry.coordinates)) {
    const flattened = JSON.stringify(geometry.coordinates).match(/-?\d+(\.\d+)?/g);

    if (flattened && flattened.length >= 2) {
      const lng = Number(flattened[0]);
      const lat = Number(flattened[1]);
      return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
    }
  }

  return null;
}

function inferCenter(features: GisFeatureCollection): [number, number] {
  const points = features.features
    .map((feature) => getPointCoordinate(feature.geometry))
    .filter((point): point is [number, number] => Boolean(point));

  if (points.length === 0) {
    return [68.7864, 38.5598];
  }

  const [lng, lat] = points.reduce(
    (total, point) => [total[0] + point[0], total[1] + point[1]] as [number, number],
    [0, 0],
  );

  return [lng / points.length, lat / points.length];
}

async function loadLayerFeatures(layerId: string) {
  return fetchGisApi<{ data: GisFeatureCollection }>(`/gis/layers/${layerId}/features`);
}

export async function loadGisWorkspace({
  incidentId,
}: {
  incidentId?: string | null;
} = {}): Promise<GisWorkspace> {
  try {
    const [incidentLayers, resourceLayers, routeLayers, incidentFeatures] =
      await Promise.all([
        fetchGisApi<{ data: GisLayer[] }>(
          `/gis/layers${query({ kind: "INCIDENT", incidentId: incidentId ?? null })}`,
        ),
        fetchGisApi<{ data: GisLayer[] }>("/gis/layers?kind=RESOURCE"),
        fetchGisApi<{ data: GisLayer[] }>("/gis/layers?kind=ROUTE"),
        incidentId
          ? fetchGisApi<{ data: GisFeatureCollection }>(
              `/gis/incidents/${incidentId}/features`,
            )
          : Promise.resolve({ data: { type: "FeatureCollection", features: [] } }),
      ]);
    const layers = [
      ...incidentLayers.data,
      ...resourceLayers.data,
      ...routeLayers.data,
    ];
    const layerFeatureCollections = await Promise.all(
      layers
        .filter((layer) => layer.kind !== "INCIDENT")
        .map((layer) => loadLayerFeatures(layer.id).catch(() => null)),
    );
    const featureById = new Map<string, GisFeature>();

    for (const feature of incidentFeatures.data.features) {
      featureById.set(feature.id, feature);
    }

    for (const collection of layerFeatureCollections) {
      for (const feature of collection?.data.features ?? []) {
        featureById.set(feature.id, feature);
      }
    }

    const features: GisFeatureCollection = {
      type: "FeatureCollection",
      features: [...featureById.values()],
    };

    return {
      source: "api",
      layers,
      features,
      incidentId: incidentId ?? null,
      center: inferCenter(features),
      zoom: incidentId ? 11 : 8,
      refreshedAt: new Date().toISOString(),
    };
  } catch {
    return mockWorkspace(incidentId);
  }
}

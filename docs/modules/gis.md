# GIS Module -- Geographic Information System

## 1. Purpose

The GIS module is the spatial awareness engine of the CoESCD disaster management platform. It provides geographic information management for hazard mapping, resource tracking, evacuation route planning, and incident-linked spatial analysis. Every map-based visualization, spatial query, and geographic overlay in the platform is powered by this module.

### Ownership Boundaries

GIS **owns**:

- Map layers and their lifecycle (create, publish, unpublish, archive, delete)
- Map features (geometry + properties) stored within layers
- Layer permissions (fine-grained read/write access per role)
- Spatial query execution (bbox, KNN, geofence intersection, clustering)
- Drawing features (ephemeral per-user annotations with TTL)
- GeoJSON import/export pipeline
- Feature-to-incident spatial linkage (computed via geofence intersection)
- Server-side feature clustering for low zoom levels

GIS **does not own**:

- Incident geofence or epicenter data (owned by the Incident module; GIS consumes geofence events)
- User identity, roles, or permissions definitions (owned by IAM; GIS queries the PDP)
- Real-time WebSocket connection management (owned by the Realtime Gateway; GIS publishes viewport-scoped updates)
- Base map tile serving (delegated to external tile servers; GIS manages vector overlay layers only)
- Resource identity or deployment lifecycle (owned by the Incident module; GIS tracks resource positions spatially)

### Design Principles

- All coordinates are stored in EPSG:4326 (WGS84) using the PostGIS `geography` type for geodetically correct distance calculations
- Coordinate precision is truncated to 7 decimal places (~1.1 cm) to avoid floating-point drift
- Spatial indexes use GiST for all geometry/geography columns
- The module targets 1M live map features with sub-200ms viewport queries
- Layer types enforce domain separation: BASE, HAZARD, RESOURCE, ROUTE, INCIDENT, DRAW

---

## 2. Domain Model

### Aggregates

#### MapLayer (Aggregate Root)

| Column       | Type        | Notes                                                                 |
| ------------ | ----------- | --------------------------------------------------------------------- |
| id           | uuid (v7)   | PK                                                                    |
| tenant_id    | uuid        | FK -> iam.tenants, NOT NULL                                           |
| code         | text        | UNIQUE per tenant, alphanumeric + hyphen + underscore, 3-80 chars     |
| name         | text        | Human-readable display name, 2-200 chars, NOT NULL                    |
| kind         | text        | CHECK (kind IN ('base','hazard','resource','route','incident','draw'))|
| style        | jsonb       | Layer rendering style (fill, stroke, icon, label config), NOT NULL    |
| property_schema | jsonb    | Optional JSON Schema for feature properties validation, nullable      |
| is_published | boolean     | Default false; true makes layer visible to users with read permission |
| max_features | integer     | Default 10000; soft limit, admin can override                         |
| incident_id  | uuid        | FK -> incident.incidents, nullable; set only for kind='incident'      |
| created_by   | uuid        | FK -> iam.users, NOT NULL, immutable                                  |
| created_at   | timestamptz | Default now()                                                         |
| updated_at   | timestamptz | Default now(), trigger-maintained                                     |
| deleted_at   | timestamptz | Nullable, soft delete                                                 |

#### MapFeature (Aggregate Root)

| Column      | Type                     | Notes                                                          |
| ----------- | ------------------------ | -------------------------------------------------------------- |
| id          | uuid (v7)                | PK                                                             |
| tenant_id   | uuid                     | FK -> iam.tenants, NOT NULL (denormalized for RLS)             |
| layer_id    | uuid                     | FK -> gis.layers, NOT NULL                                     |
| incident_id | uuid                     | FK -> incident.incidents, nullable; auto-linked via geofence   |
| geom        | geography(Geometry, 4326)| NOT NULL; supports Point, LineString, Polygon, Multi* types    |
| properties  | jsonb                    | Free-form key-value; validated against layer property_schema if defined |
| created_by  | uuid                     | FK -> iam.users, NOT NULL                                      |
| created_at  | timestamptz              | Default now()                                                  |
| updated_at  | timestamptz              | Default now(), trigger-maintained                              |
| deleted_at  | timestamptz              | Nullable, soft delete                                          |
| expires_at  | timestamptz              | Nullable; set only for DRAW layer features (24h TTL default)   |

### Entities

#### LayerPermission

| Column    | Type    | Notes                                                    |
| --------- | ------- | -------------------------------------------------------- |
| layer_id  | uuid    | FK -> gis.layers, part of composite PK                   |
| role_code | text    | IAM role code (e.g., 'field_responder'), part of composite PK |
| can_read  | boolean | Default false                                            |
| can_write | boolean | Default false                                            |

Constraint: PRIMARY KEY (layer_id, role_code)

### Value Objects

**LayerKind**

```typescript
export enum LayerKind {
  BASE     = 'base',      // Read-only base layers (admin-managed infrastructure, boundaries)
  HAZARD   = 'hazard',    // Hazard zones, flood plains, seismic zones, contamination areas
  RESOURCE = 'resource',  // Resource positions: vehicles, teams, equipment, shelters
  ROUTE    = 'route',     // Evacuation routes, supply corridors, restricted access paths
  INCIDENT = 'incident',  // Auto-created per incident; contains incident-specific features
  DRAW     = 'draw',      // Per-user ephemeral drawing annotations (24h TTL unless saved)
}
```

**Geometry**

```typescript
// GeoJSON-compatible geometry value object
// Stored as PostGIS geography(Geometry, 4326)
export type GeometryType =
  | 'Point'
  | 'LineString'
  | 'Polygon'
  | 'MultiPoint'
  | 'MultiLineString'
  | 'MultiPolygon';

export interface GeoJsonGeometry {
  type: GeometryType;
  coordinates: number[] | number[][] | number[][][] | number[][][][];
}
```

**Style**

```typescript
// Layer rendering style stored as JSONB
// Validated against this schema on create/update
export interface LayerStyle {
  fill?: {
    color: string;       // CSS color string, e.g., '#FF5733' or 'rgba(255,87,51,0.5)'
    opacity?: number;    // 0.0 - 1.0, default 0.3
  };
  stroke?: {
    color: string;       // CSS color string
    width?: number;      // pixels, 1-20, default 2
    opacity?: number;    // 0.0 - 1.0, default 1.0
    dashArray?: string;  // SVG dash-array, e.g., '5,10'
  };
  icon?: {
    url: string;         // URL to icon image (must be HTTPS, max 512 chars)
    size?: [number, number]; // [width, height] in pixels, max 128x128
    anchor?: [number, number]; // [x, y] anchor point, 0.0-1.0
  };
  label?: {
    field: string;       // Property key to use as label text
    fontSize?: number;   // pixels, 8-32, default 12
    color?: string;      // CSS color string, default '#333333'
    haloColor?: string;  // Text halo for readability, default '#FFFFFF'
    haloWidth?: number;  // pixels, 0-4, default 1
  };
  cluster?: {
    enabled: boolean;    // Enable server-side clustering below threshold zoom
    radius?: number;     // Cluster radius in pixels, 20-200, default 80
    minZoom?: number;    // Minimum zoom to start clustering, 0-13, default 0
    maxZoom?: number;    // Maximum zoom to stop clustering, 1-14, default 14
  };
}
```

**BBox**

```typescript
// Bounding box for viewport queries
// Coordinates in EPSG:4326 (WGS84)
export interface BBox {
  west: number;   // min longitude, -180 to 180
  south: number;  // min latitude, -90 to 90
  east: number;   // max longitude, -180 to 180
  north: number;  // max latitude, -90 to 90
}
```

---

## 3. Business Rules

### Invariants

1. **Feature-layer binding**: Every `MapFeature` must reference a valid `layer_id` within the same `tenant_id`. A feature cannot exist without a layer. Deleting a layer soft-deletes all its features.

2. **BASE layer immutability**: Layers with `kind = 'base'` are read-only for all users except `platform_admin`. BASE layers contain foundational geographic data (administrative boundaries, infrastructure, roads) that must not be modified during incident operations.

3. **INCIDENT layer auto-creation**: When the GIS module consumes `incident.created.v1`, it automatically creates a MapLayer with `kind = 'incident'` and `incident_id` set. This layer is pre-configured with default incident style and permissions. The layer `code` follows the pattern `incident-{incident_code}` (e.g., `incident-EQ-2026-04-0012`).

4. **INCIDENT layer lifecycle**: When `incident.closed.v1` is consumed, the incident layer is unpublished and its `is_published` flag set to false. Features remain accessible for post-incident analysis. When the incident is archived, the layer is soft-deleted.

5. **Coordinate precision**: All coordinates are truncated to 7 decimal places before storage. This provides ~1.1 cm precision, which is sufficient for disaster management while avoiding floating-point accumulation errors.

6. **EPSG:4326 enforcement**: All geometries are stored in EPSG:4326. If a client submits coordinates in a different CRS, the API rejects with `GIS_PROJECTION_ERROR` and instructs the client to reproject. On read, the API can reproject to a requested SRID via the `srid` query parameter.

7. **Geofence auto-linking**: When `incident.geofence_updated.v1` is consumed, the GIS module runs a spatial query to find all features that intersect the new geofence and sets their `incident_id` to the incident. Features that no longer intersect have their `incident_id` cleared.

8. **Layer publish gate**: Publishing a layer (`is_published = true`) makes it visible to all roles that have `can_read = true` in `gis.layer_permissions`. A layer must have at least one feature to be published. An empty layer cannot be published.

9. **Style validation**: The `style` JSONB column is validated against the `LayerStyle` schema on every create and update. Invalid style configurations (e.g., icon URL not HTTPS, font size out of range) are rejected with `GIS_INVALID_STYLE`.

10. **Feature capacity limit**: Each layer has a `max_features` soft limit (default 10,000). When the limit is reached, new feature creation returns `GIS_LAYER_CAPACITY_EXCEEDED`. The limit can be overridden by `platform_admin` by updating the layer's `max_features` value.

11. **Drawing feature TTL**: Features in DRAW layers have an `expires_at` set to 24 hours from creation. A `pg_cron` job runs every 15 minutes to soft-delete expired drawing features. Any interaction with a drawing feature (update, read by owner) extends the TTL by 24 hours.

12. **Property schema enforcement**: If a layer defines a `property_schema` (JSON Schema), all feature `properties` must validate against it. Features with invalid properties are rejected with detailed validation errors.

13. **Geometry validation**: All geometries are validated using `ST_IsValid()` before storage. Invalid geometries (self-intersecting polygons, degenerate lines) are rejected with `GIS_INVALID_GEOMETRY` including a description of the issue and a suggestion to use `ST_MakeValid`.

14. **Large polygon simplification**: Polygons with more than 1,000 vertices are simplified using `ST_Simplify` (tolerance 0.0001 degrees, ~11 meters) before storage. The original geometry is preserved in `properties._original_geometry` as a GeoJSON string for reference.

### Constraints

| Constraint                                | Enforcement        |
| ----------------------------------------- | ------------------ |
| `(tenant_id, code)` unique per layer      | UNIQUE index       |
| `(layer_id, role_code)` unique permission | Composite PK       |
| `kind` in allowed enum                    | CHECK constraint   |
| `name` 2-200 chars                        | CHECK + app layer  |
| `code` 3-80 chars, alphanumeric + `-_`    | CHECK + app layer  |
| `geom` NOT NULL on features               | NOT NULL constraint|
| `geom` is valid geometry                  | App layer + ST_IsValid |
| `max_features` between 1 and 1,000,000    | CHECK constraint   |
| `style` conforms to LayerStyle schema     | App layer          |
| `properties` conforms to layer schema     | App layer          |
| Feature references layer in same tenant   | App layer + FK     |
| INCIDENT layer has non-null incident_id   | App layer          |

### Validation Rules

```typescript
// Enforced at both DTO (class-validator) and domain entity level

// Layer name: 2-200 characters, no leading/trailing whitespace
name: string; // @Length(2, 200) @Trim()

// Layer code: 3-80 characters, alphanumeric + hyphen + underscore
code: string; // @Matches(/^[a-z0-9][a-z0-9_-]{1,78}[a-z0-9]$/)

// Kind: must be a valid enum value
kind: LayerKind; // @IsEnum(LayerKind)

// Style: validated against LayerStyle JSON Schema
style: LayerStyle; // @ValidateNested() @IsObject()

// Geometry: valid GeoJSON geometry
geometry: GeoJsonGeometry; // Custom validator: type in allowed list, coordinates valid

// Coordinates: latitude -90 to 90, longitude -180 to 180, max 7 decimal places
// Applied recursively to all coordinate arrays in geometry

// Properties: valid JSON object, max 64KB serialized
properties?: Record<string, unknown>; // @IsObject() @IsOptional()

// BBox: valid coordinate range
west: number;  // @Min(-180) @Max(180)
south: number; // @Min(-90) @Max(90)
east: number;  // @Min(-180) @Max(180)
north: number; // @Min(-90) @Max(90)
```

---

## 4. Use Cases

### Commands

#### CreateLayer

**Actor:** gis_analyst or platform_admin
**Input:** code, name, kind, style, property_schema?, max_features?
**Flow:**

1. Validate all input fields including style against LayerStyle schema
2. Verify `code` is unique within tenant: `SELECT 1 FROM gis.layers WHERE tenant_id = :tenantId AND code = :code AND deleted_at IS NULL`
3. If `kind = 'base'`, verify actor is `platform_admin`
4. If `kind = 'incident'`, reject -- incident layers are auto-created via event
5. Set `is_published = false`, `created_by = actor.userId`
6. Persist layer
7. Create default permissions: `gis_analyst` gets read+write, `field_responder` gets read
8. Publish outbox message: `gis.layer.created.v1`
9. Return created layer

**Idempotency:** Supports `Idempotency-Key` header. Duplicate key returns previously created layer.

#### UpdateLayer

**Actor:** layer creator or gis_analyst+
**Input:** name?, style?, property_schema?, max_features?
**Flow:**

1. Load layer, verify not deleted
2. If `kind = 'base'`, verify actor is `platform_admin`
3. Validate changed fields
4. If `property_schema` changed and layer has features, validate all existing features against new schema in background (async); flag layer with `schema_migration_pending` until complete
5. Apply changes, update `updated_at`
6. Publish `gis.layer.updated.v1`

#### PublishLayer

**Actor:** layer creator (for own layers), gis_analyst+, or platform_admin
**Input:** layer_id
**Flow:**

1. Load layer, verify not deleted and not already published
2. Verify layer has at least one feature: `SELECT count(*) FROM gis.features WHERE layer_id = :id AND deleted_at IS NULL`
3. If count is 0, reject with `GIS_LAYER_EMPTY`
4. Set `is_published = true`
5. Publish `gis.layer.published.v1`
6. Invalidate Redis cache for layer list queries in this tenant

#### UnpublishLayer

**Actor:** layer creator (for own layers), gis_analyst+, or platform_admin
**Input:** layer_id
**Flow:**

1. Load layer, verify is published
2. Set `is_published = false`
3. Publish `gis.layer.unpublished.v1`
4. Invalidate Redis cache

#### DeleteLayer

**Actor:** layer creator or platform_admin
**Input:** layer_id
**Flow:**

1. Load layer, verify not deleted
2. If `kind = 'base'`, verify actor is `platform_admin`
3. If `kind = 'incident'`, reject -- incident layers are managed by lifecycle events
4. Soft-delete layer: set `deleted_at = now()`
5. Soft-delete all features in layer: `UPDATE gis.features SET deleted_at = now() WHERE layer_id = :id AND deleted_at IS NULL`
6. Delete layer permissions: `DELETE FROM gis.layer_permissions WHERE layer_id = :id`
7. Publish `gis.layer.deleted.v1`

#### CreateFeature

**Actor:** gis_analyst, or incident_commander (on incident layers)
**Input:** layer_id, geometry (GeoJSON), properties?
**Flow:**

1. Load layer, verify not deleted
2. If `kind = 'base'`, reject with `GIS_LAYER_READONLY`
3. Check feature count: if `count >= layer.max_features`, reject with `GIS_LAYER_CAPACITY_EXCEEDED`
4. Validate geometry: parse GeoJSON, check `ST_IsValid`, check coordinate ranges
5. If polygon with > 1000 vertices, simplify with `ST_Simplify(geom, 0.0001)`, store original in `properties._original_geometry`
6. Truncate coordinates to 7 decimal places
7. If layer has `property_schema`, validate `properties` against it
8. If `kind = 'draw'`, set `expires_at = now() + interval '24 hours'`
9. Compute `incident_id`: query active incidents whose geofence contains this feature's geometry
10. Persist feature
11. Publish `gis.feature.created.v1`
12. Broadcast to WebSocket subscribers whose viewport bbox intersects the new feature

#### UpdateFeature

**Actor:** feature creator or gis_analyst
**Input:** feature_id, geometry?, properties?
**Flow:**

1. Load feature and its layer, verify neither is deleted
2. If layer `kind = 'base'`, reject with `GIS_LAYER_READONLY`
3. Verify actor is feature creator or has gis_analyst role
4. If geometry changed: validate, simplify if needed, truncate coordinates
5. If geometry changed: recompute `incident_id` from geofence intersection
6. If properties changed and layer has `property_schema`: validate
7. If `kind = 'draw'`: extend `expires_at` by 24 hours from now
8. Apply changes, update `updated_at`
9. Publish `gis.feature.updated.v1`
10. Broadcast update to viewport subscribers

#### DeleteFeature

**Actor:** feature creator or gis_analyst
**Input:** feature_id
**Flow:**

1. Load feature, verify not already deleted
2. If layer `kind = 'base'`, reject with `GIS_LAYER_READONLY`
3. Soft-delete: set `deleted_at = now()`
4. Publish `gis.feature.deleted.v1`
5. Broadcast deletion to viewport subscribers

#### BulkImportFeatures

**Actor:** gis_analyst+
**Input:** layer_id, geojson (FeatureCollection), overwrite (boolean, default false)
**Flow:**

1. Load layer, verify not deleted, not BASE, not INCIDENT
2. Parse and validate GeoJSON FeatureCollection
3. Check total features: if `existing_count + import_count > layer.max_features`, reject with `GIS_LAYER_CAPACITY_EXCEEDED`
4. If `overwrite = true`, soft-delete all existing features in the layer
5. Chunk features into batches of 500
6. For each batch:
   a. Validate all geometries (`ST_IsValid`)
   b. Truncate coordinates to 7 decimal places
   c. If layer has `property_schema`, validate all feature properties
   d. Simplify polygons with > 1000 vertices
   e. Bulk INSERT using `unnest` arrays for performance
   f. Emit progress event to WebSocket: `gis.import.progress` with `{ layerId, processed, total, errors }`
7. Compute `incident_id` for all imported features via spatial join with active incident geofences
8. Publish `gis.feature.bulk_imported.v1` with summary
9. Return import summary: `{ imported, skipped, errors: [{index, reason}] }`

**Processing:** For imports > 5,000 features, processing is delegated to a background worker via NATS JetStream. The API returns HTTP 202 Accepted with a job ID. Progress is streamed via WebSocket.

#### UpdateLayerPermissions

**Actor:** layer creator or platform_admin
**Input:** layer_id, permissions: Array<{ role_code, can_read, can_write }>
**Flow:**

1. Load layer, verify not deleted
2. Validate all role_codes exist in IAM (batch query)
3. Upsert permissions: `INSERT ... ON CONFLICT (layer_id, role_code) DO UPDATE`
4. Invalidate permission cache in Redis
5. Return updated permissions list

#### CreateDrawingFeature

**Actor:** any authenticated user
**Input:** geometry (GeoJSON), properties?, layer_id? (optional; if omitted, auto-create or reuse user's DRAW layer)
**Flow:**

1. If `layer_id` not provided:
   a. Find user's existing DRAW layer: `SELECT id FROM gis.layers WHERE tenant_id = :tenantId AND kind = 'draw' AND created_by = :userId AND deleted_at IS NULL`
   b. If not found, create a new DRAW layer with code `draw-{userId-short}` and name `Drawing - {userName}`
2. Validate geometry
3. Set `expires_at = now() + interval '24 hours'`
4. Persist feature
5. Publish `gis.feature.created.v1`

### Queries

#### ListLayers

**Actor:** any authenticated user
**Parameters:** cursor, limit (max 100, default 25), filter[kind], filter[is_published], filter[incident_id], sort (name_asc | name_desc | created_at_desc | created_at_asc)
**Implementation:**

- RLS filters by `tenant_id`
- Unpublished layers are visible only to their creator and gis_analyst+
- Layer permissions further filter visibility: join with `gis.layer_permissions` on user's role
- Cursor-based pagination using `(created_at, id)` composite cursor
- Redis cache for published layer lists (invalidated on layer change events), TTL 60 seconds

```sql
SELECT l.id, l.code, l.name, l.kind, l.style, l.is_published,
       l.max_features, l.incident_id, l.created_by, l.created_at, l.updated_at,
       count(f.id) AS feature_count
FROM gis.layers l
LEFT JOIN gis.features f ON f.layer_id = l.id AND f.deleted_at IS NULL
WHERE l.tenant_id = :tenantId
  AND l.deleted_at IS NULL
  AND (
      l.is_published = true
      OR l.created_by = :userId
      OR :userRoleLevel >= 4  -- gis_analyst+
  )
  AND EXISTS (
      SELECT 1 FROM gis.layer_permissions lp
      WHERE lp.layer_id = l.id AND lp.role_code = :userRoleCode AND lp.can_read = true
  )
GROUP BY l.id
ORDER BY l.created_at DESC, l.id DESC;
```

#### GetLayer

**Actor:** any authenticated user with read permission on the layer
**Returns:** Full layer DTO including:
- All layer fields
- Permissions list
- Feature count
- Bounding box of all features (`ST_Extent`)

```sql
SELECT l.*,
       count(f.id) AS feature_count,
       ST_AsGeoJSON(ST_Extent(f.geom::geometry))::jsonb AS bbox
FROM gis.layers l
LEFT JOIN gis.features f ON f.layer_id = l.id AND f.deleted_at IS NULL
WHERE l.id = :layerId
  AND l.tenant_id = :tenantId
  AND l.deleted_at IS NULL
GROUP BY l.id;
```

#### ListFeatures

**Actor:** any authenticated user with read permission on the layer
**Parameters:** layer_id?, incident_id?, cursor, limit (max 500, default 100)
**Implementation:** Cursor-based pagination using `(created_at, id)`. At least one of `layer_id` or `incident_id` is required.

#### GetFeature

**Actor:** any authenticated user with read permission on the feature's layer
**Returns:** Full feature DTO with geometry as GeoJSON and resolved layer info.

#### GetFeaturesInBbox

**Actor:** any authenticated user
**Parameters:** west, south, east, north, layer_id? (optional filter), limit (max 5000, default 1000), srid? (reprojection target)
**Implementation:**

```sql
SELECT f.id, f.layer_id, f.incident_id,
       ST_AsGeoJSON(f.geom)::jsonb AS geometry,
       f.properties, f.created_by, f.created_at
FROM gis.features f
JOIN gis.layers l ON l.id = f.layer_id
WHERE f.tenant_id = :tenantId
  AND f.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND l.is_published = true
  AND ST_Intersects(
      f.geom,
      ST_MakeEnvelope(:west, :south, :east, :north, 4326)::geography
  )
  AND (:layerId IS NULL OR f.layer_id = :layerId)
ORDER BY f.created_at DESC
LIMIT :limit;
```

For zoom levels < 14, server-side clustering is applied:

```sql
SELECT
    cluster_id,
    count(*) AS point_count,
    ST_AsGeoJSON(ST_Centroid(ST_Collect(f.geom::geometry)))::jsonb AS center,
    min(f.id) AS representative_id
FROM (
    SELECT f.*,
           ST_ClusterDBSCAN(f.geom::geometry, eps := :clusterRadius, minpoints := 2)
               OVER () AS cluster_id
    FROM gis.features f
    JOIN gis.layers l ON l.id = f.layer_id
    WHERE f.tenant_id = :tenantId
      AND f.deleted_at IS NULL
      AND l.deleted_at IS NULL
      AND l.is_published = true
      AND ST_Intersects(
          f.geom,
          ST_MakeEnvelope(:west, :south, :east, :north, 4326)::geography
      )
) f
GROUP BY cluster_id;
```

#### GetFeaturesInGeofence

**Actor:** any authenticated user with incident read permission
**Parameters:** incident_id
**Implementation:**

```sql
SELECT f.id, f.layer_id,
       ST_AsGeoJSON(f.geom)::jsonb AS geometry,
       f.properties, f.created_by
FROM gis.features f
JOIN incident.incidents i ON i.id = :incidentId
WHERE f.tenant_id = :tenantId
  AND f.deleted_at IS NULL
  AND ST_Intersects(f.geom, i.geofence)
ORDER BY f.layer_id, f.created_at;
```

#### GetNearestFeatures

**Actor:** any authenticated user
**Parameters:** lat, lng, limit (max 50, default 10), layer_id? (optional filter), radius_meters? (optional max distance, default 50000)
**Implementation:**

```sql
SELECT f.id, f.layer_id,
       ST_AsGeoJSON(f.geom)::jsonb AS geometry,
       f.properties,
       ST_Distance(f.geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS distance_meters
FROM gis.features f
JOIN gis.layers l ON l.id = f.layer_id
WHERE f.tenant_id = :tenantId
  AND f.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND l.is_published = true
  AND (:layerId IS NULL OR f.layer_id = :layerId)
  AND ST_DWithin(f.geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)
ORDER BY f.geom <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
LIMIT :limit;
```

#### GetLayerStats

**Actor:** gis_analyst+
**Parameters:** layer_id
**Returns:** Feature count, geometry type distribution, bounding box, average feature area (for polygons), last updated feature timestamp.

```sql
SELECT
    count(*) AS feature_count,
    count(*) FILTER (WHERE ST_GeometryType(f.geom::geometry) = 'ST_Point') AS point_count,
    count(*) FILTER (WHERE ST_GeometryType(f.geom::geometry) = 'ST_LineString') AS linestring_count,
    count(*) FILTER (WHERE ST_GeometryType(f.geom::geometry) = 'ST_Polygon') AS polygon_count,
    count(*) FILTER (WHERE ST_GeometryType(f.geom::geometry) LIKE 'ST_Multi%') AS multi_count,
    ST_AsGeoJSON(ST_Extent(f.geom::geometry))::jsonb AS bbox,
    avg(ST_Area(f.geom)) FILTER (WHERE ST_GeometryType(f.geom::geometry) IN ('ST_Polygon', 'ST_MultiPolygon')) AS avg_area_sq_meters,
    max(f.updated_at) AS last_feature_updated_at
FROM gis.features f
WHERE f.layer_id = :layerId
  AND f.deleted_at IS NULL;
```

#### ExportLayer

**Actor:** any authenticated user with read permission on the layer
**Parameters:** layer_id, format (geojson), srid? (reprojection target, default 4326)
**Implementation:** Streams features as a GeoJSON FeatureCollection. For layers with > 10,000 features, the response is streamed with `Transfer-Encoding: chunked`.

```sql
SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', jsonb_agg(
        jsonb_build_object(
            'type', 'Feature',
            'id', f.id,
            'geometry', ST_AsGeoJSON(
                CASE WHEN :srid = 4326 THEN f.geom::geometry
                     ELSE ST_Transform(f.geom::geometry, :srid)
                END
            )::jsonb,
            'properties', f.properties || jsonb_build_object(
                '_id', f.id,
                '_layer_id', f.layer_id,
                '_created_at', f.created_at
            )
        )
    )
) AS geojson
FROM gis.features f
WHERE f.layer_id = :layerId
  AND f.tenant_id = :tenantId
  AND f.deleted_at IS NULL;
```

#### GetFieldUnitPositions

**Actor:** incident_commander or shift_lead+
**Parameters:** incident_id?, bbox?
**Implementation:** Returns the latest known positions of all resource-type features from RESOURCE layers, filtered by incident geofence or viewport bbox.

```sql
SELECT f.id, f.properties->>'resource_id' AS resource_id,
       f.properties->>'name' AS name,
       f.properties->>'resource_type' AS resource_type,
       f.properties->>'status' AS status,
       ST_AsGeoJSON(f.geom)::jsonb AS position,
       f.updated_at AS last_seen_at
FROM gis.features f
JOIN gis.layers l ON l.id = f.layer_id AND l.kind = 'resource'
WHERE f.tenant_id = :tenantId
  AND f.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND (:incidentId IS NULL OR f.incident_id = :incidentId)
  AND (:bbox IS NULL OR ST_Intersects(f.geom, ST_MakeEnvelope(:west, :south, :east, :north, 4326)::geography))
ORDER BY f.updated_at DESC;
```

#### SearchFeatures

**Actor:** any authenticated user with read permission
**Parameters:** query (text to search in properties), layer_id?, limit (max 100, default 25)
**Implementation:** Uses GIN index on `properties` JSONB for text search.

```sql
SELECT f.id, f.layer_id,
       ST_AsGeoJSON(f.geom)::jsonb AS geometry,
       f.properties
FROM gis.features f
JOIN gis.layers l ON l.id = f.layer_id
WHERE f.tenant_id = :tenantId
  AND f.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND l.is_published = true
  AND (:layerId IS NULL OR f.layer_id = :layerId)
  AND f.properties::text ILIKE '%' || :query || '%'
ORDER BY f.created_at DESC
LIMIT :limit;
```

---

## 5. API Contracts

### DTOs

```typescript
import {
  IsString, IsOptional, IsEnum, IsInt, Min, Max, Length,
  MaxLength, IsUUID, ValidateNested, IsArray, ArrayMaxSize,
  IsNumber, IsObject, IsBoolean, Matches, IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Geo DTOs ──────────────────────────────────────────────

export class GeoJsonGeometryDto {
  @IsString()
  @IsEnum(['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'])
  type: string;

  @IsArray()
  coordinates: number[] | number[][] | number[][][] | number[][][][];
  // Custom validator ensures coordinates match geometry type and are within valid range
}

export class BBoxDto {
  @IsNumber()
  @Min(-180)
  @Max(180)
  west: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  south: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  east: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  north: number;
}

export class LayerStyleDto {
  @IsOptional()
  @IsObject()
  fill?: { color: string; opacity?: number };

  @IsOptional()
  @IsObject()
  stroke?: { color: string; width?: number; opacity?: number; dashArray?: string };

  @IsOptional()
  @IsObject()
  icon?: { url: string; size?: [number, number]; anchor?: [number, number] };

  @IsOptional()
  @IsObject()
  label?: { field: string; fontSize?: number; color?: string; haloColor?: string; haloWidth?: number };

  @IsOptional()
  @IsObject()
  cluster?: { enabled: boolean; radius?: number; minZoom?: number; maxZoom?: number };
}

// ── Command DTOs ──────────────────────────────────────────

export class CreateLayerDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,78}[a-z0-9]$/)
  code: string;

  @IsString()
  @Length(2, 200)
  name: string;

  @IsEnum(LayerKind)
  kind: LayerKind;

  @ValidateNested()
  @Type(() => LayerStyleDto)
  style: LayerStyleDto;

  @IsOptional()
  @IsObject()
  propertySchema?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxFeatures?: number;
}

export class UpdateLayerDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LayerStyleDto)
  style?: LayerStyleDto;

  @IsOptional()
  @IsObject()
  propertySchema?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxFeatures?: number;
}

export class CreateFeatureDto {
  @IsUUID()
  layerId: string;

  @ValidateNested()
  @Type(() => GeoJsonGeometryDto)
  geometry: GeoJsonGeometryDto;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;
}

export class UpdateFeatureDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoJsonGeometryDto)
  geometry?: GeoJsonGeometryDto;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;
}

export class BulkImportFeaturesDto {
  @IsObject()
  geojson: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      geometry: GeoJsonGeometryDto;
      properties?: Record<string, unknown>;
    }>;
  };

  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

export class UpdateLayerPermissionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LayerPermissionEntryDto)
  permissions: LayerPermissionEntryDto[];
}

export class LayerPermissionEntryDto {
  @IsString()
  @Length(3, 50)
  roleCode: string;

  @IsBoolean()
  canRead: boolean;

  @IsBoolean()
  canWrite: boolean;
}

export class CreateDrawingFeatureDto {
  @ValidateNested()
  @Type(() => GeoJsonGeometryDto)
  geometry: GeoJsonGeometryDto;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  layerId?: string;
}

// ── Response DTOs ─────────────────────────────────────────

export class LayerDto {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  kind: LayerKind;
  style: LayerStyleDto;
  propertySchema: Record<string, unknown> | null;
  isPublished: boolean;
  maxFeatures: number;
  incidentId: string | null;
  featureCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class LayerDetailDto extends LayerDto {
  permissions: LayerPermissionDto[];
  bbox: GeoJsonGeometryDto | null;
}

export class LayerPermissionDto {
  roleCode: string;
  canRead: boolean;
  canWrite: boolean;
}

export class FeatureDto {
  id: string;
  tenantId: string;
  layerId: string;
  incidentId: string | null;
  geometry: GeoJsonGeometryDto;
  properties: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export class FeatureClusterDto {
  clusterId: number;
  pointCount: number;
  center: GeoJsonGeometryDto;
  representativeId: string;
}

export class BulkImportResultDto {
  imported: number;
  skipped: number;
  errors: Array<{ index: number; reason: string }>;
  jobId?: string;  // Set when processing is async (> 5000 features)
}

export class LayerStatsDto {
  featureCount: number;
  pointCount: number;
  linestringCount: number;
  polygonCount: number;
  multiCount: number;
  bbox: GeoJsonGeometryDto | null;
  avgAreaSqMeters: number | null;
  lastFeatureUpdatedAt: string | null;
}

export class FieldUnitPositionDto {
  id: string;
  resourceId: string;
  name: string;
  resourceType: string;
  status: string;
  position: GeoJsonGeometryDto;
  lastSeenAt: string;
}
```

### Endpoints

```
POST   /api/v1/gis/layers
  Body: CreateLayerDto
  Headers: Idempotency-Key (optional, UUID)
  Response 201: { data: LayerDto }
  Errors: 400 (validation), 409 (code conflict), 403 (BASE layer requires platform_admin)

GET    /api/v1/gis/layers
  Query: cursor, limit (1-100, default 25),
         filter[kind], filter[is_published], filter[incident_id],
         sort (name_asc | name_desc | created_at_desc | created_at_asc)
  Response 200: { data: LayerDto[], page: { nextCursor, prevCursor, limit, hasMore } }

GET    /api/v1/gis/layers/:id
  Response 200: { data: LayerDetailDto }
  Errors: 404 GIS_LAYER_NOT_FOUND

PATCH  /api/v1/gis/layers/:id
  Body: UpdateLayerDto
  Response 200: { data: LayerDto }
  Errors: 404, 403, 422 GIS_LAYER_READONLY (for BASE layers)

DELETE /api/v1/gis/layers/:id
  Response 204
  Errors: 404, 403, 422 GIS_LAYER_READONLY

POST   /api/v1/gis/layers/:id/publish
  Response 200: { data: LayerDto }
  Errors: 404, 403, 422 GIS_LAYER_EMPTY (no features to publish)

POST   /api/v1/gis/layers/:id/unpublish
  Response 200: { data: LayerDto }
  Errors: 404, 403

PUT    /api/v1/gis/layers/:id/permissions
  Body: UpdateLayerPermissionsDto
  Response 200: { data: LayerPermissionDto[] }
  Errors: 404, 403

GET    /api/v1/gis/layers/:id/stats
  Response 200: { data: LayerStatsDto }
  Errors: 404, 403

GET    /api/v1/gis/layers/:id/export
  Query: format (geojson, default geojson), srid (integer, default 4326)
  Response 200: GeoJSON FeatureCollection (Content-Type: application/geo+json)
  Headers: Content-Disposition: attachment; filename="{layer_code}.geojson"
  Errors: 404, 403

POST   /api/v1/gis/features
  Body: CreateFeatureDto
  Response 201: { data: FeatureDto }
  Errors: 400 GIS_INVALID_GEOMETRY, 422 GIS_LAYER_READONLY, 422 GIS_LAYER_CAPACITY_EXCEEDED

GET    /api/v1/gis/features
  Query: layer_id, incident_id, cursor, limit (1-500, default 100)
  Response 200: { data: FeatureDto[], page: { nextCursor, prevCursor, limit, hasMore } }
  Errors: 400 (must provide layer_id or incident_id)

GET    /api/v1/gis/features/:id
  Response 200: { data: FeatureDto }
  Errors: 404 GIS_FEATURE_NOT_FOUND

PATCH  /api/v1/gis/features/:id
  Body: UpdateFeatureDto
  Response 200: { data: FeatureDto }
  Errors: 404, 403, 400 GIS_INVALID_GEOMETRY, 422 GIS_LAYER_READONLY

DELETE /api/v1/gis/features/:id
  Response 204
  Errors: 404, 403, 422 GIS_LAYER_READONLY

POST   /api/v1/gis/features/bulk
  Body: BulkImportFeaturesDto
  Query: layer_id (required)
  Response 200: { data: BulkImportResultDto }  (synchronous, < 5000 features)
  Response 202: { data: { jobId: string } }     (async, >= 5000 features)
  Errors: 400 GIS_IMPORT_FAILED, 422 GIS_LAYER_READONLY, 422 GIS_LAYER_CAPACITY_EXCEEDED

GET    /api/v1/gis/features/bbox
  Query: west (required), south (required), east (required), north (required),
         layer_id (optional), zoom (optional, integer 0-22),
         limit (1-5000, default 1000), srid (optional, default 4326)
  Response 200: { data: (FeatureDto | FeatureClusterDto)[], meta: { clustered: boolean, zoom: number } }

GET    /api/v1/gis/features/nearest
  Query: lat (required), lng (required), limit (1-50, default 10),
         layer_id (optional), radius_meters (optional, max 500000, default 50000)
  Response 200: { data: Array<FeatureDto & { distanceMeters: number }> }

GET    /api/v1/gis/features/geofence
  Query: incident_id (required), layer_id (optional)
  Response 200: { data: FeatureDto[] }

GET    /api/v1/gis/features/search
  Query: q (required, min 2 chars), layer_id (optional), limit (1-100, default 25)
  Response 200: { data: FeatureDto[] }

GET    /api/v1/gis/field-units
  Query: incident_id (optional), west, south, east, north (optional bbox)
  Response 200: { data: FieldUnitPositionDto[] }

POST   /api/v1/gis/draw
  Body: CreateDrawingFeatureDto
  Response 201: { data: FeatureDto }
```

### WebSocket Scope

Clients subscribe to viewport-scoped feature updates:

```
Topic: map:bbox:{west},{south},{east},{north}
```

The server evaluates which connected viewports intersect with a feature change and pushes updates to matching subscribers.

**Inbound messages (client to server):**

```json
{
  "action": "subscribe",
  "scope": "map:bbox:68.78,38.77,68.80,38.79"
}
```

```json
{
  "action": "unsubscribe",
  "scope": "map:bbox:68.78,38.77,68.80,38.79"
}
```

**Outbound messages (server to client):**

```json
{
  "type": "feature.created",
  "data": {
    "id": "019526b0-1000-7000-8000-000000000001",
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "geometry": { "type": "Point", "coordinates": [68.79, 38.78] },
    "properties": { "name": "Shelter Alpha", "capacity": 200 }
  }
}
```

```json
{
  "type": "feature.updated",
  "data": {
    "id": "019526b0-1000-7000-8000-000000000001",
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "geometry": { "type": "Point", "coordinates": [68.79, 38.78] },
    "properties": { "name": "Shelter Alpha", "capacity": 250, "status": "full" }
  }
}
```

```json
{
  "type": "feature.deleted",
  "data": {
    "id": "019526b0-1000-7000-8000-000000000001",
    "layerId": "019526a0-9000-7000-8000-000000000001"
  }
}
```

```json
{
  "type": "import.progress",
  "data": {
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "jobId": "019526c0-1000-7000-8000-000000000001",
    "processed": 2500,
    "total": 10000,
    "errors": 3
  }
}
```

### Error Codes

| Code                        | HTTP | Description                                                                  |
| --------------------------- | ---- | ---------------------------------------------------------------------------- |
| GIS_LAYER_NOT_FOUND         | 404  | Layer does not exist or is not visible to the requesting user                |
| GIS_FEATURE_NOT_FOUND       | 404  | Feature does not exist or is not visible to the requesting user              |
| GIS_INVALID_GEOMETRY        | 400  | Geometry is invalid (self-intersecting, degenerate, wrong type)              |
| GIS_LAYER_READONLY          | 422  | Cannot modify features on a BASE layer (or INCIDENT layer via direct API)    |
| GIS_LAYER_CAPACITY_EXCEEDED | 422  | Layer has reached its max_features limit                                     |
| GIS_IMPORT_FAILED           | 400  | Bulk import failed; response includes per-feature error details              |
| GIS_PROJECTION_ERROR        | 400  | Input coordinates are not in EPSG:4326 or requested SRID is unsupported      |
| GIS_LAYER_EMPTY             | 422  | Cannot publish a layer with zero features                                    |
| GIS_INVALID_STYLE           | 400  | Layer style JSON does not conform to LayerStyle schema                       |
| GIS_LAYER_CODE_CONFLICT     | 409  | Layer code already exists within this tenant                                 |
| GIS_INVALID_BBOX            | 400  | Bounding box coordinates are invalid (west > east or south > north)          |
| GIS_DRAW_LAYER_LIMIT        | 422  | User already has a DRAW layer (one per user per tenant)                      |
| GIS_PROPERTY_VALIDATION     | 400  | Feature properties do not conform to the layer's property_schema             |

---

## 6. Events

All events are published to NATS JetStream via the transactional outbox pattern. Each event includes a standard envelope:

```typescript
interface EventEnvelope<T> {
  id: string;          // UUIDv7, unique per event
  type: string;        // e.g., "gis.layer.created.v1"
  source: string;      // "gis-module"
  tenantId: string;
  timestamp: string;   // ISO 8601
  correlationId: string;
  data: T;
}
```

### Produced Events

#### gis.layer.created.v1

```json
{
  "id": "019526b0-1000-7000-8000-000000000001",
  "type": "gis.layer.created.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:00:00.000Z",
  "correlationId": "019526b0-1000-7000-8000-000000000099",
  "data": {
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "code": "flood-zones-northern",
    "name": "Flood Zones - Northern Region",
    "kind": "hazard",
    "isPublished": false,
    "createdBy": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### gis.layer.published.v1

```json
{
  "id": "019526b0-2000-7000-8000-000000000001",
  "type": "gis.layer.published.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:15:00.000Z",
  "correlationId": "019526b0-2000-7000-8000-000000000099",
  "data": {
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "code": "flood-zones-northern",
    "kind": "hazard",
    "featureCount": 342,
    "publishedBy": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### gis.layer.unpublished.v1

```json
{
  "id": "019526b0-2100-7000-8000-000000000001",
  "type": "gis.layer.unpublished.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:20:00.000Z",
  "correlationId": "019526b0-2100-7000-8000-000000000099",
  "data": {
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "code": "flood-zones-northern",
    "unpublishedBy": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### gis.layer.updated.v1

```json
{
  "id": "019526b0-2200-7000-8000-000000000001",
  "type": "gis.layer.updated.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:25:00.000Z",
  "correlationId": "019526b0-2200-7000-8000-000000000099",
  "data": {
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "changes": {
      "name": {
        "before": "Flood Zones - Northern",
        "after": "Flood Zones - Northern Region"
      },
      "style": {
        "before": { "fill": { "color": "#0000FF", "opacity": 0.2 } },
        "after": { "fill": { "color": "#0066FF", "opacity": 0.3 } }
      }
    },
    "actorId": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### gis.layer.deleted.v1

```json
{
  "id": "019526b0-3000-7000-8000-000000000001",
  "type": "gis.layer.deleted.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T11:00:00.000Z",
  "correlationId": "019526b0-3000-7000-8000-000000000099",
  "data": {
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "code": "flood-zones-northern",
    "kind": "hazard",
    "featureCount": 342,
    "deletedBy": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### gis.feature.created.v1

```json
{
  "id": "019526b0-4000-7000-8000-000000000001",
  "type": "gis.feature.created.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:05:00.000Z",
  "correlationId": "019526b0-4000-7000-8000-000000000099",
  "data": {
    "featureId": "019526b0-1000-7000-8000-000000000010",
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[68.78, 38.77], [68.80, 38.77], [68.80, 38.79], [68.78, 38.79], [68.78, 38.77]]]
    },
    "properties": {
      "name": "Flood Zone Alpha",
      "risk_level": "high",
      "affected_population": 12000
    },
    "createdBy": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### gis.feature.updated.v1

```json
{
  "id": "019526b0-5000-7000-8000-000000000001",
  "type": "gis.feature.updated.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:30:00.000Z",
  "correlationId": "019526b0-5000-7000-8000-000000000099",
  "data": {
    "featureId": "019526b0-1000-7000-8000-000000000010",
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "geometryChanged": true,
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[68.77, 38.76], [68.81, 38.76], [68.81, 38.80], [68.77, 38.80], [68.77, 38.76]]]
    },
    "propertiesChanged": true,
    "properties": {
      "name": "Flood Zone Alpha (Expanded)",
      "risk_level": "critical",
      "affected_population": 25000
    },
    "actorId": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### gis.feature.deleted.v1

```json
{
  "id": "019526b0-6000-7000-8000-000000000001",
  "type": "gis.feature.deleted.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T11:05:00.000Z",
  "correlationId": "019526b0-6000-7000-8000-000000000099",
  "data": {
    "featureId": "019526b0-1000-7000-8000-000000000010",
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "incidentId": "019526a0-7c00-7000-8000-000000000010",
    "deletedBy": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### gis.feature.bulk_imported.v1

```json
{
  "id": "019526b0-7000-7000-8000-000000000001",
  "type": "gis.feature.bulk_imported.v1",
  "source": "gis-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T10:10:00.000Z",
  "correlationId": "019526b0-7000-7000-8000-000000000099",
  "data": {
    "layerId": "019526a0-9000-7000-8000-000000000001",
    "imported": 4850,
    "skipped": 12,
    "errors": 3,
    "overwrite": false,
    "importedBy": "019526a0-1000-7000-8000-000000000050",
    "durationMs": 3240
  }
}
```

### Consumed Events

#### incident.created.v1

**Source:** Incident module
**Handler:** Auto-create an INCIDENT layer for the new incident.

```typescript
@EventHandler('incident.created.v1')
async handleIncidentCreated(event: IncidentCreatedEvent): Promise<void> {
  const { incidentId, code, title, epicenter } = event.data;

  // Create incident layer
  const layer = MapLayer.create({
    tenantId: event.tenantId,
    code: `incident-${code.toLowerCase()}`,
    name: `Incident Layer - ${title}`,
    kind: LayerKind.INCIDENT,
    style: {
      fill: { color: '#FF0000', opacity: 0.2 },
      stroke: { color: '#FF0000', width: 3, opacity: 0.8 },
      icon: { url: 'https://assets.coescd.app/icons/incident-marker.png', size: [32, 32], anchor: [0.5, 1.0] },
      label: { field: 'name', fontSize: 12, color: '#CC0000', haloColor: '#FFFFFF', haloWidth: 2 },
    },
    incidentId,
    createdBy: event.data.createdBy,
  });

  await this.layerRepository.save(layer);

  // Set default permissions: all responders can read, IC and analysts can write
  await this.permissionRepository.bulkUpsert(layer.id, [
    { roleCode: 'field_responder', canRead: true, canWrite: false },
    { roleCode: 'duty_operator', canRead: true, canWrite: false },
    { roleCode: 'incident_commander', canRead: true, canWrite: true },
    { roleCode: 'gis_analyst', canRead: true, canWrite: true },
    { roleCode: 'shift_lead', canRead: true, canWrite: true },
    { roleCode: 'tenant_admin', canRead: true, canWrite: true },
  ]);

  // If incident has an epicenter, create the epicenter feature
  if (epicenter) {
    const feature = MapFeature.create({
      tenantId: event.tenantId,
      layerId: layer.id,
      incidentId,
      geom: { type: 'Point', coordinates: [epicenter.lng, epicenter.lat] },
      properties: { name: `Epicenter - ${code}`, type: 'epicenter', incidentCode: code },
      createdBy: event.data.createdBy,
    });
    await this.featureRepository.save(feature);
  }

  // Auto-publish the incident layer
  layer.publish();
  await this.layerRepository.save(layer);

  await this.eventBus.publish({
    type: 'gis.layer.created.v1',
    data: { layerId: layer.id, code: layer.code, kind: 'incident', incidentId },
  });
}
```

#### incident.geofence_updated.v1

**Source:** Incident module
**Handler:** Re-query features within the new geofence and update incident_id linkage.

```typescript
@EventHandler('incident.geofence_updated.v1')
async handleGeofenceUpdated(event: IncidentGeofenceUpdatedEvent): Promise<void> {
  const { incidentId, geofence } = event.data;

  // Clear existing incident linkage for features no longer in geofence
  await this.featureRepository.clearIncidentLink(incidentId);

  // Find all features that intersect the new geofence and link them
  // Uses ST_Intersects with the new geofence polygon
  const affectedCount = await this.featureRepository.linkFeaturesInGeofence(
    event.tenantId,
    incidentId,
    geofence,
  );

  // Also create/update the geofence outline feature on the incident layer
  const incidentLayer = await this.layerRepository.findByIncidentId(incidentId);
  if (incidentLayer) {
    const existingGeofenceFeature = await this.featureRepository.findByLayerAndProperty(
      incidentLayer.id,
      'type',
      'geofence',
    );

    if (existingGeofenceFeature) {
      existingGeofenceFeature.updateGeometry(geofence);
      await this.featureRepository.save(existingGeofenceFeature);
    } else {
      const feature = MapFeature.create({
        tenantId: event.tenantId,
        layerId: incidentLayer.id,
        incidentId,
        geom: geofence,
        properties: { name: 'Area of Operations', type: 'geofence' },
        createdBy: event.data.actorId,
      });
      await this.featureRepository.save(feature);
    }
  }

  this.logger.log(`Linked ${affectedCount} features to incident ${incidentId} via geofence update`);
}
```

#### incident.closed.v1

**Source:** Incident module
**Handler:** Unpublish and archive the incident layer.

```typescript
@EventHandler('incident.closed.v1')
async handleIncidentClosed(event: IncidentClosedEvent): Promise<void> {
  const { incidentId } = event.data;

  const layer = await this.layerRepository.findByIncidentId(incidentId);
  if (!layer) {
    this.logger.warn(`No incident layer found for closed incident ${incidentId}`);
    return;
  }

  // Unpublish the layer (features remain for post-incident analysis)
  layer.unpublish();
  await this.layerRepository.save(layer);

  await this.eventBus.publish({
    type: 'gis.layer.unpublished.v1',
    data: { layerId: layer.id, code: layer.code, reason: 'incident_closed' },
  });
}
```

#### iam.user.deactivated.v1

**Source:** IAM module
**Handler:** Remove all drawing features created by the deactivated user.

```typescript
@EventHandler('iam.user.deactivated.v1')
async handleUserDeactivated(event: UserDeactivatedEvent): Promise<void> {
  const { userId } = event.data;

  // Soft-delete all drawing features by this user
  const deletedCount = await this.featureRepository.softDeleteByCreator(userId, {
    layerKind: LayerKind.DRAW,
  });

  // Also soft-delete the user's DRAW layer if it exists
  const drawLayer = await this.layerRepository.findDrawLayerByUser(event.tenantId, userId);
  if (drawLayer) {
    drawLayer.softDelete();
    await this.layerRepository.save(drawLayer);
  }

  this.logger.log(`Cleaned up ${deletedCount} drawing features for deactivated user ${userId}`);
}
```

---

## 7. Database Schema

### DDL

```sql
-- =============================================================================
-- Schema
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS gis;

-- =============================================================================
-- Enable PostGIS extension (if not already enabled)
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- =============================================================================
-- layers
-- =============================================================================
CREATE TABLE gis.layers (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES iam.tenants(id),
    code            text            NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,78}[a-z0-9]$'),
    name            text            NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
    kind            text            NOT NULL CHECK (kind IN (
                        'base', 'hazard', 'resource', 'route', 'incident', 'draw'
                    )),
    style           jsonb           NOT NULL DEFAULT '{}',
    property_schema jsonb,
    is_published    boolean         NOT NULL DEFAULT false,
    max_features    integer         NOT NULL DEFAULT 10000 CHECK (max_features BETWEEN 1 AND 1000000),
    incident_id     uuid            REFERENCES incident.incidents(id),
    created_by      uuid            NOT NULL REFERENCES iam.users(id),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

-- Unique layer code per tenant (only for non-deleted layers)
CREATE UNIQUE INDEX idx_layers_tenant_code ON gis.layers (tenant_id, code) WHERE deleted_at IS NULL;

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_layers_tenant_id ON gis.layers (tenant_id) WHERE deleted_at IS NULL;

-- Kind filtering
CREATE INDEX idx_layers_tenant_kind ON gis.layers (tenant_id, kind) WHERE deleted_at IS NULL;

-- Published layer listing
CREATE INDEX idx_layers_tenant_published ON gis.layers (tenant_id, is_published) WHERE deleted_at IS NULL;

-- Incident layer lookup
CREATE UNIQUE INDEX idx_layers_incident_id ON gis.layers (incident_id) WHERE incident_id IS NOT NULL AND deleted_at IS NULL;

-- Creator lookup (for user's own layers)
CREATE INDEX idx_layers_created_by ON gis.layers (created_by) WHERE deleted_at IS NULL;

-- Cursor-based pagination composite
CREATE INDEX idx_layers_cursor ON gis.layers (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION gis.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_layers_updated_at
    BEFORE UPDATE ON gis.layers
    FOR EACH ROW
    EXECUTE FUNCTION gis.update_updated_at();

-- =============================================================================
-- features
-- =============================================================================
CREATE TABLE gis.features (
    id          uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid                            NOT NULL REFERENCES iam.tenants(id),
    layer_id    uuid                            NOT NULL REFERENCES gis.layers(id),
    incident_id uuid                            REFERENCES incident.incidents(id),
    geom        geography(Geometry, 4326)       NOT NULL,
    properties  jsonb                           NOT NULL DEFAULT '{}',
    created_by  uuid                            NOT NULL REFERENCES iam.users(id),
    created_at  timestamptz                     NOT NULL DEFAULT now(),
    updated_at  timestamptz                     NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    expires_at  timestamptz
);

-- GIST index on geography for all spatial queries (THE critical index)
CREATE INDEX idx_features_geom_gist ON gis.features USING GIST (geom) WHERE deleted_at IS NULL;

-- Tenant isolation (RLS filter path)
CREATE INDEX idx_features_tenant_id ON gis.features (tenant_id) WHERE deleted_at IS NULL;

-- Layer lookup
CREATE INDEX idx_features_layer_id ON gis.features (layer_id) WHERE deleted_at IS NULL;

-- Incident lookup (features linked to an incident)
CREATE INDEX idx_features_incident_id ON gis.features (incident_id) WHERE incident_id IS NOT NULL AND deleted_at IS NULL;

-- Creator lookup (for permission checks and DRAW layer queries)
CREATE INDEX idx_features_created_by ON gis.features (created_by) WHERE deleted_at IS NULL;

-- Cursor-based pagination composite
CREATE INDEX idx_features_cursor ON gis.features (layer_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- Expiring features (DRAW layer TTL cleanup)
CREATE INDEX idx_features_expires_at ON gis.features (expires_at) WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

-- GIN index on properties for JSONB search
CREATE INDEX idx_features_properties_gin ON gis.features USING GIN (properties) WHERE deleted_at IS NULL;

-- Composite index for bbox queries with layer filter
CREATE INDEX idx_features_layer_geom ON gis.features USING GIST (geom) WHERE deleted_at IS NULL;

-- Trigger: auto-update updated_at
CREATE TRIGGER trg_features_updated_at
    BEFORE UPDATE ON gis.features
    FOR EACH ROW
    EXECUTE FUNCTION gis.update_updated_at();

-- =============================================================================
-- layer_permissions
-- =============================================================================
CREATE TABLE gis.layer_permissions (
    layer_id    uuid        NOT NULL REFERENCES gis.layers(id) ON DELETE CASCADE,
    role_code   text        NOT NULL CHECK (char_length(role_code) BETWEEN 3 AND 50),
    can_read    boolean     NOT NULL DEFAULT false,
    can_write   boolean     NOT NULL DEFAULT false,
    PRIMARY KEY (layer_id, role_code)
);

-- Role-based permission lookup
CREATE INDEX idx_layer_permissions_role ON gis.layer_permissions (role_code);

-- =============================================================================
-- outbox (transactional outbox for event publishing)
-- =============================================================================
CREATE TABLE gis.outbox (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregatetype   text            NOT NULL DEFAULT 'gis',
    aggregateid     uuid            NOT NULL,
    type            text            NOT NULL,
    payload         jsonb           NOT NULL,
    tenant_id       uuid            NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX idx_outbox_unpublished ON gis.outbox (created_at)
    WHERE published_at IS NULL;

-- =============================================================================
-- Coordinate precision function
-- =============================================================================
CREATE OR REPLACE FUNCTION gis.truncate_coordinates(geom geography, decimals integer DEFAULT 7)
RETURNS geography AS $$
BEGIN
    RETURN ST_SnapToGrid(geom::geometry, power(10, -decimals))::geography;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- =============================================================================
-- Drawing feature TTL cleanup (scheduled via pg_cron)
-- =============================================================================
-- Run every 15 minutes
-- SELECT cron.schedule('gis-draw-cleanup', '*/15 * * * *', $$
--     UPDATE gis.features
--     SET deleted_at = now()
--     WHERE expires_at < now()
--       AND deleted_at IS NULL
--       AND expires_at IS NOT NULL;
-- $$);

CREATE OR REPLACE FUNCTION gis.cleanup_expired_drawings()
RETURNS integer AS $$
DECLARE
    affected integer;
BEGIN
    UPDATE gis.features
    SET deleted_at = now()
    WHERE expires_at < now()
      AND deleted_at IS NULL
      AND expires_at IS NOT NULL;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Row-Level Security (RLS)
-- =============================================================================
ALTER TABLE gis.layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE gis.features ENABLE ROW LEVEL SECURITY;
ALTER TABLE gis.layer_permissions ENABLE ROW LEVEL SECURITY;

-- Policy: layers visible to same tenant
CREATE POLICY tenant_isolation ON gis.layers
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: published layers visible to users with read permission;
-- unpublished layers visible to creator and gis_analyst+
CREATE POLICY layer_visibility ON gis.layers
    FOR SELECT
    USING (
        deleted_at IS NULL
        AND (
            (is_published = true AND EXISTS (
                SELECT 1 FROM gis.layer_permissions lp
                WHERE lp.layer_id = id
                  AND lp.role_code = current_setting('app.current_user_role')
                  AND lp.can_read = true
            ))
            OR created_by = current_setting('app.current_user_id')::uuid
            OR current_setting('app.current_user_role_level')::smallint >= 4  -- gis_analyst+
        )
    );

-- Policy: layer modification requires write permission or ownership
CREATE POLICY layer_modification ON gis.layers
    FOR UPDATE
    USING (
        deleted_at IS NULL
        AND (
            created_by = current_setting('app.current_user_id')::uuid
            OR current_setting('app.current_user_role_level')::smallint >= 5  -- platform_admin
        )
    );

-- Policy: features visible to same tenant (layer visibility enforced at app layer via JOIN)
CREATE POLICY tenant_isolation ON gis.features
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: features — soft delete filter
CREATE POLICY active_features ON gis.features
    FOR SELECT
    USING (
        deleted_at IS NULL
    );

-- Policy: layer_permissions — visible via layer tenant
CREATE POLICY tenant_isolation ON gis.layer_permissions
    USING (
        EXISTS (
            SELECT 1 FROM gis.layers l
            WHERE l.id = layer_id
              AND l.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );
```

### Sample Spatial Queries

#### Find all features within an incident's geofence (ST_Intersects)

```sql
-- Used when incident.geofence_updated.v1 is consumed
-- Links features to the incident by updating incident_id
UPDATE gis.features f
SET incident_id = :incidentId
FROM incident.incidents i
WHERE i.id = :incidentId
  AND f.tenant_id = i.tenant_id
  AND f.deleted_at IS NULL
  AND ST_Intersects(f.geom, i.geofence);
```

#### Find features within a given distance of a point (ST_DWithin)

```sql
-- Used for "nearest shelter" type queries
SELECT f.id,
       ST_AsGeoJSON(f.geom)::jsonb AS geometry,
       f.properties,
       ST_Distance(f.geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS distance_meters
FROM gis.features f
JOIN gis.layers l ON l.id = f.layer_id AND l.kind = 'resource'
WHERE f.tenant_id = :tenantId
  AND f.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND ST_DWithin(f.geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)
ORDER BY distance_meters
LIMIT :limit;
```

#### K-Nearest Neighbors query (<-> operator)

```sql
-- Used for GetNearestFeatures
-- The <-> operator uses the GiST index for efficient KNN search
SELECT f.id,
       ST_AsGeoJSON(f.geom)::jsonb AS geometry,
       f.properties,
       f.geom <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS distance
FROM gis.features f
JOIN gis.layers l ON l.id = f.layer_id
WHERE f.tenant_id = :tenantId
  AND f.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND l.is_published = true
ORDER BY f.geom <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
LIMIT :limit;
```

#### Features within bounding box (ST_MakeEnvelope)

```sql
-- Used for viewport queries (GetFeaturesInBbox)
SELECT f.id, f.layer_id,
       ST_AsGeoJSON(f.geom)::jsonb AS geometry,
       f.properties
FROM gis.features f
JOIN gis.layers l ON l.id = f.layer_id
WHERE f.tenant_id = :tenantId
  AND f.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND l.is_published = true
  AND f.geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)::geography
ORDER BY f.layer_id, f.created_at DESC
LIMIT :limit;
```

#### Server-side clustering for low zoom levels (ST_ClusterDBSCAN)

```sql
-- Used when zoom < 14 in bbox queries
-- eps is computed from zoom level: approximately 0.01 * 2^(14 - zoom) degrees
WITH clustered AS (
    SELECT f.id, f.geom,
           ST_ClusterDBSCAN(f.geom::geometry, eps := :eps, minpoints := 2)
               OVER () AS cluster_id
    FROM gis.features f
    JOIN gis.layers l ON l.id = f.layer_id
    WHERE f.tenant_id = :tenantId
      AND f.deleted_at IS NULL
      AND l.deleted_at IS NULL
      AND l.is_published = true
      AND f.geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)::geography
)
SELECT
    cluster_id,
    count(*) AS point_count,
    ST_AsGeoJSON(ST_Centroid(ST_Collect(geom::geometry)))::jsonb AS center,
    (array_agg(id ORDER BY id))[1] AS representative_id
FROM clustered
WHERE cluster_id IS NOT NULL
GROUP BY cluster_id
UNION ALL
-- Unclustered features (singletons)
SELECT
    NULL AS cluster_id,
    1 AS point_count,
    ST_AsGeoJSON(geom)::jsonb AS center,
    id AS representative_id
FROM clustered
WHERE cluster_id IS NULL;
```

#### Compute area of polygon features (ST_Area)

```sql
-- Used in GetLayerStats
SELECT f.id, f.properties->>'name' AS name,
       ST_Area(f.geom) AS area_sq_meters,
       ST_Area(f.geom) / 1000000.0 AS area_sq_km
FROM gis.features f
WHERE f.layer_id = :layerId
  AND f.deleted_at IS NULL
  AND ST_GeometryType(f.geom::geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
ORDER BY area_sq_meters DESC;
```

#### Reproject geometry on read (ST_Transform)

```sql
-- Used when client requests features in a different SRID
SELECT f.id,
       ST_AsGeoJSON(ST_Transform(f.geom::geometry, :targetSrid))::jsonb AS geometry,
       f.properties
FROM gis.features f
WHERE f.layer_id = :layerId
  AND f.tenant_id = :tenantId
  AND f.deleted_at IS NULL;
```

#### Validate and fix geometry (ST_IsValid / ST_MakeValid)

```sql
-- Used during feature creation validation
-- Application layer first checks ST_IsValid; if invalid, suggests ST_MakeValid
SELECT
    ST_IsValid(ST_GeomFromGeoJSON(:geojson)) AS is_valid,
    ST_IsValidReason(ST_GeomFromGeoJSON(:geojson)) AS reason;

-- If the user opts in to auto-fix (not default behavior):
SELECT ST_AsGeoJSON(
    ST_MakeValid(ST_GeomFromGeoJSON(:geojson))
)::jsonb AS fixed_geometry;
```

#### Simplify large polygons (ST_Simplify)

```sql
-- Applied automatically to polygons with > 1000 vertices before storage
SELECT ST_AsGeoJSON(
    ST_Simplify(ST_GeomFromGeoJSON(:geojson), 0.0001, true)
)::jsonb AS simplified_geometry,
ST_NPoints(ST_GeomFromGeoJSON(:geojson)) AS original_vertices,
ST_NPoints(ST_Simplify(ST_GeomFromGeoJSON(:geojson), 0.0001, true)) AS simplified_vertices;
```

---

## 8. Permissions (IAM Integration)

Every operation maps to a permission string evaluated by the IAM module's Policy Decision Point (PDP). The GIS module sends authorization queries to IAM before executing commands.

### Permission Matrix

| Operation                        | Permission String              | Minimum Role         | Additional Conditions                             |
| -------------------------------- | ------------------------------ | -------------------- | ------------------------------------------------- |
| List layers                      | `gis.layer.read`               | field_responder      | Published layers only; unpublished requires owner or gis_analyst+ |
| Get layer detail                 | `gis.layer.read`               | field_responder      | Layer permission check (can_read)                 |
| Create layer                     | `gis.layer.create`             | gis_analyst          |                                                    |
| Create BASE layer                | `gis.layer.create`             | platform_admin       | BASE layers restricted to platform_admin           |
| Update layer                     | `gis.layer.update`             | gis_analyst          | Own layers or platform_admin                       |
| Publish layer (own)              | `gis.layer.publish`            | gis_analyst          | Must be layer creator                              |
| Publish layer (any)              | `gis.layer.publish`            | platform_admin       |                                                    |
| Unpublish layer                  | `gis.layer.publish`            | gis_analyst          | Own layers or platform_admin                       |
| Delete layer                     | `gis.layer.delete`             | gis_analyst          | Own layers; platform_admin can delete any           |
| Update layer permissions         | `gis.layer.permissions`        | gis_analyst          | Own layers or platform_admin                       |
| List features                    | `gis.feature.read`             | field_responder      | Layer read permission required                     |
| Get feature                      | `gis.feature.read`             | field_responder      | Layer read permission required                     |
| Query features (bbox/nearest)    | `gis.feature.read`             | field_responder      | Published layers only                              |
| Create feature                   | `gis.feature.create`           | gis_analyst          | Layer write permission required                    |
| Create feature (incident layer)  | `gis.feature.create`           | incident_commander   | Must be IC of the linked incident                  |
| Update feature                   | `gis.feature.update`           | gis_analyst          | Feature creator or layer write permission          |
| Delete feature                   | `gis.feature.delete`           | gis_analyst          | Feature creator or layer write permission          |
| Bulk import features             | `gis.feature.import`           | gis_analyst          | Not on BASE or INCIDENT layers                     |
| Create drawing feature           | `gis.draw.create`              | field_responder      | Any authenticated user; own DRAW layer only        |
| Export layer                     | `gis.layer.export`             | gis_analyst          | Layer read permission required                     |
| View field unit positions        | `gis.field_unit.read`          | incident_commander   | IC or shift_lead+                                  |
| Modify BASE layer features       | `gis.base.modify`              | platform_admin       | Only platform_admin can touch BASE layers          |

### Role Hierarchy (Reference)

```
field_responder (1) < duty_operator (2) < incident_commander (3) < gis_analyst (4) < shift_lead (5) < tenant_admin (6) < platform_admin (7)
```

### Layer Permission Enforcement

The GIS module uses a two-tier authorization model:

1. **IAM PDP check**: The global permission (e.g., `gis.feature.create`) is checked first via the IAM PDP
2. **Layer permission check**: After the global check passes, the layer-specific permission is checked via `gis.layer_permissions`

```typescript
// Pseudocode for layer-scoped authorization
async canAccessLayer(userId: string, roleCode: string, layerId: string, action: 'read' | 'write'): Promise<boolean> {
  // 1. Check global permission via IAM PDP
  const globalPermission = action === 'read' ? 'gis.feature.read' : 'gis.feature.create';
  const hasGlobal = await this.pdp.evaluate(userId, globalPermission);
  if (!hasGlobal) return false;

  // 2. Check layer-specific permission
  const layerPerm = await this.permissionRepository.findByLayerAndRole(layerId, roleCode);
  if (!layerPerm) return false;

  return action === 'read' ? layerPerm.canRead : layerPerm.canWrite;
}
```

### Default Permissions by Layer Kind

When a layer is created, default permissions are applied based on the layer kind:

| Layer Kind | field_responder | duty_operator | incident_commander | gis_analyst | shift_lead | tenant_admin | platform_admin |
| ---------- | --------------- | ------------- | ------------------ | ----------- | ---------- | ------------ | -------------- |
| base       | R               | R             | R                  | R           | R          | R            | RW             |
| hazard     | R               | R             | R                  | RW          | RW         | RW           | RW             |
| resource   | R               | R             | RW                 | RW          | RW         | RW           | RW             |
| route      | R               | R             | R                  | RW          | RW         | RW           | RW             |
| incident   | R               | R             | RW                 | RW          | RW         | RW           | RW             |
| draw       | --              | --            | --                 | --          | --         | --           | --             |

R = can_read, W = can_write, RW = both, -- = per-user (DRAW layers are private to creator)

---

## 9. Edge Cases

### Failure Scenarios

**Invalid geometry (self-intersecting polygon):**
- The feature creation handler calls `ST_IsValid()` on the parsed geometry before insertion
- If invalid, the handler calls `ST_IsValidReason()` to get a human-readable explanation (e.g., "Self-intersection at POINT(68.79 38.78)")
- The API returns HTTP 400 with error code `GIS_INVALID_GEOMETRY` and includes: `{ "error": "GIS_INVALID_GEOMETRY", "detail": "Self-intersection at POINT(68.79 38.78)", "suggestion": "Use ST_MakeValid on the client side or submit with ?auto_fix=true to let the server fix it" }`
- If `auto_fix=true` query parameter is provided, the server applies `ST_MakeValid` and stores the result, adding `_auto_fixed: true` to properties

**Bulk import with 50,000 features:**
- Imports > 5,000 features are delegated to a NATS JetStream worker
- The API returns HTTP 202 Accepted with `{ "jobId": "..." }`
- The worker processes in chunks of 500 features per database transaction
- Each chunk: validate geometries, truncate coordinates, simplify large polygons, validate properties
- Progress events are broadcast via WebSocket: `{ type: "import.progress", data: { layerId, jobId, processed, total, errors } }`
- Invalid features within a chunk are skipped (not rolled back), and their index + error reason are collected
- On completion, `gis.feature.bulk_imported.v1` is published with summary statistics
- If the worker crashes mid-import, NATS redelivers the job. The worker uses the job ID for idempotency: it checks how many features were already imported for this job and resumes from the last successful chunk

**Viewport query returns too many features:**
- When `zoom < 14` is provided in the bbox query, the server applies `ST_ClusterDBSCAN` to aggregate nearby features into clusters
- The cluster epsilon is computed from the zoom level: `eps = 0.01 * 2^(14 - zoom)` degrees
- The response includes a `meta.clustered: true` flag so the client knows to render cluster markers
- At `zoom >= 14`, individual features are returned up to the `limit` parameter (max 5,000)
- If the raw feature count exceeds the limit even at high zoom, features are ordered by `created_at DESC` and truncated, with a `meta.truncated: true` flag

**Feature update while spatial index is being rebuilt:**
- PostgreSQL's MVCC ensures that ongoing reads see a consistent snapshot
- `CREATE INDEX CONCURRENTLY` is used for any index maintenance to avoid blocking writes
- Feature updates are INSERT/UPDATE operations that update the GiST index incrementally, not requiring a full rebuild
- The GiST index handles concurrent modifications natively

**Drawing feature TTL expires during active session:**
- When a user interacts with their drawing feature (view, update), the handler extends `expires_at` by 24 hours: `UPDATE gis.features SET expires_at = now() + interval '24 hours' WHERE id = :id AND expires_at IS NOT NULL`
- A "save" action removes the `expires_at` entirely, making the feature permanent (it becomes a regular feature in the DRAW layer)
- The `pg_cron` cleanup job runs every 15 minutes and only deletes features where `expires_at < now()`, so there is a maximum 15-minute window where an expired feature might still be visible
- If a user's WebSocket connection drops and they reconnect, the client should re-fetch their drawing features; expired ones will not appear

**Coordinate precision floating-point issues:**
- All coordinates are truncated to 7 decimal places using `ST_SnapToGrid(geom::geometry, 1e-7)::geography` before storage
- This provides ~1.1 cm precision at the equator, which exceeds the requirements for disaster management
- The truncation is applied in a database trigger to ensure consistency even for direct SQL operations
- Comparison operations use a tolerance of `1e-7` degrees to avoid false negatives from floating-point rounding

**Large polygon geofence (>1000 vertices):**
- The application layer counts vertices using `ST_NPoints()` before storage
- If the count exceeds 1,000, the polygon is simplified using `ST_Simplify(geom, 0.0001, true)` where `true` preserves topology
- The original unsimplified geometry is stored in `properties._original_geometry` as a GeoJSON string
- The tolerance of 0.0001 degrees (~11 meters) is sufficient for disaster management geofences
- If simplification reduces the polygon below its minimum viable size, the original is stored and a warning is added to the response: `meta.simplified: true, meta.originalVertices: 1247, meta.simplifiedVertices: 483`

### Concurrency Issues

**Two users update the same feature simultaneously:**
- Optimistic locking on the `updated_at` column
- Each handler reads the feature with its `updated_at` value
- The UPDATE includes `WHERE updated_at = :expectedUpdatedAt`
- If the UPDATE affects 0 rows, the handler throws HTTP 409 CONFLICT with the current feature state so the client can merge changes

**Layer publish while features are being imported:**
- The publish handler checks feature count at the time of execution
- If a bulk import is in progress (job status is `running`), the publish is rejected with `GIS_IMPORT_IN_PROGRESS`
- After import completes, the layer can be published

**Concurrent geofence updates for different incidents:**
- Each `incident.geofence_updated.v1` handler runs in its own transaction
- Feature `incident_id` updates are `SET incident_id = :incidentId WHERE ST_Intersects(...)` scoped to a single incident
- If a feature falls within multiple incident geofences, the most recently updated incident "wins" (last-write-wins)
- This is acceptable because multi-incident overlap is rare and the downstream display shows features on all incident layers anyway

### Race Conditions

**Feature created just after geofence update event is processed:**
- The `CreateFeature` handler computes `incident_id` at creation time by querying all active incident geofences
- This handles the case where a feature is created after the bulk geofence update ran
- Conversely, the next geofence update will re-link features, so the linkage is eventually consistent

**Bulk import and single feature creation happen concurrently on the same layer:**
- Feature count is checked at the start of both operations
- In the worst case, the layer may temporarily exceed `max_features` by at most one batch size (500)
- The layer's `max_features` is a soft limit; the post-import count check logs a warning if exceeded but does not roll back
- A background job runs daily to identify layers over capacity and alert their owners

**Drawing feature cleanup runs while user is saving:**
- The save operation (removing `expires_at`) runs in a transaction
- The cleanup job soft-deletes expired features using `WHERE expires_at < now() AND deleted_at IS NULL`
- If the save transaction commits first, `expires_at` is NULL, so the cleanup job skips it
- If the cleanup job commits first, the save transaction reads the feature with `deleted_at IS NOT NULL` (MVCC snapshot), and the save handler returns `GIS_FEATURE_NOT_FOUND` -- the client retries, creating a new feature
- The window for this race is extremely narrow (< 1 second) given the 15-minute cleanup interval

### Performance Safeguards

**Spatial query timeout:**
- All spatial queries have a `statement_timeout` of 5 seconds: `SET LOCAL statement_timeout = '5s'`
- If the timeout fires, the handler returns HTTP 503 with `Retry-After: 1` and a degradation flag
- The timeout is logged as a metric for monitoring

**Index maintenance:**
- GiST indexes on geography columns are maintained automatically by PostgreSQL
- For bulk imports, the import worker temporarily sets `maintenance_work_mem` to 256 MB for faster index updates
- After large imports (> 10,000 features), `ANALYZE gis.features` is run to update table statistics

**Connection pool saturation:**
- Spatial queries use a separate database connection pool (pool name: `gis-spatial`) with a maximum of 10 connections
- This prevents expensive spatial queries from starving simple CRUD operations
- The CRUD pool (`gis-crud`) has a maximum of 20 connections

---

## 10. Relations with Other Modules

### Incident Module

**Relationship:** `gis.features.incident_id` FK references `incident.incidents.id`; `gis.layers.incident_id` FK references `incident.incidents.id`

**Integration pattern:**
- The Incident module emits lifecycle events; the GIS module reacts
- `incident.created.v1` -> auto-create incident layer with default style and permissions
- `incident.geofence_updated.v1` -> re-link features within geofence, create/update geofence outline feature
- `incident.closed.v1` -> unpublish incident layer
- The GIS module never calls the Incident module synchronously; all integration is event-driven

### IAM Module

**Relationship:** GIS queries the IAM PDP for authorization decisions

**Integration pattern:**
- Every command is authorized via the IAM PDP before execution
- Layer-specific permissions (via `gis.layer_permissions`) supplement global IAM permissions
- `iam.user.deactivated.v1` -> clean up user's drawing features and DRAW layer
- Role hierarchy is used for layer visibility (unpublished layers visible to gis_analyst+)

### Realtime Gateway

**Relationship:** GIS publishes viewport-scoped updates; the Realtime Gateway delivers them to WebSocket clients

**Integration pattern:**
- Feature create/update/delete events include geometry, which the Realtime Gateway uses to match against subscribed viewport bboxes
- Import progress events are scoped to the layer ID and delivered to clients watching that layer
- The GIS module publishes to NATS subjects like `gis.viewport.{tenantId}` and the Realtime Gateway filters by bbox intersection

### Notification Module

**Relationship:** Event-driven; GIS emits events that Notification may consume

**Integration pattern:**
- `gis.layer.published.v1` could trigger notifications to relevant roles
- `gis.feature.bulk_imported.v1` could notify the import initiator of completion
- The GIS module does not call the Notification module directly

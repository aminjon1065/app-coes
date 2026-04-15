ALTER TABLE incident.incidents
  ADD COLUMN IF NOT EXISTS geofence geometry(Geometry, 4326),
  ADD COLUMN IF NOT EXISTS epicenter geometry(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_incidents_geofence
  ON incident.incidents USING GIST (geofence)
  WHERE geofence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_epicenter
  ON incident.incidents USING GIST (epicenter)
  WHERE epicenter IS NOT NULL;

COMMENT ON COLUMN incident.incidents.geofence IS
  'Operational area polygon in EPSG:4326. Set by IC or GIS analyst.';
COMMENT ON COLUMN incident.incidents.epicenter IS
  'Single point of origin (earthquake, explosion, etc.).';

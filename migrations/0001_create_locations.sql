-- Create locations table with generated columns for GeoJSON extraction
CREATE TABLE locations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id  TEXT NOT NULL,
    geojson    TEXT NOT NULL,

    -- generated columns (extracted from geojson, STORED for indexing)
    lon         REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.geometry.coordinates[0]')
                ) STORED,
    lat         REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.geometry.coordinates[1]')
                ) STORED,
    altitude    REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.altitude')
                ) STORED,
    speed       REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.speed')
                ) STORED,
    accuracy    REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.horizontal_accuracy')
                ) STORED,
    battery     REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.battery_level')
                ) STORED,
    recorded_at TEXT GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.timestamp')
                ) STORED,

    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Primary query: device x time series
CREATE INDEX idx_device_time ON locations(device_id, recorded_at DESC);

-- Spatial search (bounding box)
CREATE INDEX idx_lat ON locations(lat);
CREATE INDEX idx_lon ON locations(lon);

-- Daily archive
CREATE INDEX idx_recorded_date ON locations(
    substr(recorded_at, 1, 10)
);

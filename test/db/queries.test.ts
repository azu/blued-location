import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertLocations, getLocations } from "../../src/db/queries";

const createFeature = (
  lon: number,
  lat: number,
  timestamp: string,
  device_id: string,
  options: {
    altitude?: number;
    speed?: number;
    horizontal_accuracy?: number;
    battery_level?: number;
  } = {}
) => ({
  type: "Feature" as const,
  geometry: {
    type: "Point" as const,
    coordinates: [lon, lat],
  },
  properties: {
    timestamp,
    device_id,
    ...options,
  },
});

describe("insertLocations", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM locations");
  });

  it("inserts a single location", async () => {
    const feature = createFeature(139.7, 35.6, "2026-02-01T10:00:00Z", "test-device");
    const locations = [
      {
        device_id: "test-device",
        geojson: JSON.stringify(feature),
      },
    ];

    const result = await insertLocations(env.DB, locations);
    expect(result.count).toBe(1);

    const rows = await env.DB.prepare("SELECT * FROM locations").all();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].device_id).toBe("test-device");
    expect(rows.results[0].lon).toBe(139.7);
    expect(rows.results[0].lat).toBe(35.6);
  });

  it("inserts multiple locations in a batch", async () => {
    const locations = [
      {
        device_id: "device-1",
        geojson: JSON.stringify(createFeature(139.7, 35.6, "2026-02-01T10:00:00Z", "device-1")),
      },
      {
        device_id: "device-1",
        geojson: JSON.stringify(createFeature(139.8, 35.7, "2026-02-01T10:05:00Z", "device-1")),
      },
      {
        device_id: "device-2",
        geojson: JSON.stringify(createFeature(140.0, 36.0, "2026-02-01T10:10:00Z", "device-2")),
      },
    ];

    const result = await insertLocations(env.DB, locations);
    expect(result.count).toBe(3);

    const rows = await env.DB.prepare("SELECT * FROM locations ORDER BY id").all();
    expect(rows.results.length).toBe(3);
  });

  it("returns count 0 for empty array", async () => {
    const result = await insertLocations(env.DB, []);
    expect(result.count).toBe(0);
  });

  it("extracts generated columns correctly", async () => {
    const feature = createFeature(139.7099, 35.6476, "2026-02-01T14:30:00Z", "iphone-test", {
      altitude: 40,
      speed: 1.2,
      horizontal_accuracy: 10,
      battery_level: 0.85,
    });
    const locations = [{ device_id: "iphone-test", geojson: JSON.stringify(feature) }];

    await insertLocations(env.DB, locations);

    const row = await env.DB.prepare("SELECT * FROM locations WHERE device_id = ?")
      .bind("iphone-test")
      .first();

    expect(row?.lon).toBe(139.7099);
    expect(row?.lat).toBe(35.6476);
    expect(row?.altitude).toBe(40);
    expect(row?.speed).toBe(1.2);
    expect(row?.accuracy).toBe(10);
    expect(row?.battery).toBe(0.85);
    expect(row?.recorded_at).toBe("2026-02-01T14:30:00Z");
  });
});

describe("getLocations", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM locations");

    // Insert test data
    const testData = [
      createFeature(139.7, 35.6, "2026-02-01T10:00:00Z", "device-a"),
      createFeature(139.8, 35.7, "2026-02-01T12:00:00Z", "device-a"),
      createFeature(140.0, 36.0, "2026-02-02T10:00:00Z", "device-a"),
      createFeature(139.5, 35.5, "2026-02-01T11:00:00Z", "device-b"),
    ];

    await insertLocations(
      env.DB,
      testData.map((f) => ({
        device_id: f.properties.device_id,
        geojson: JSON.stringify(f),
      }))
    );
  });

  it("returns all locations when no filters", async () => {
    const rows = await getLocations(env.DB, {});
    expect(rows.length).toBe(4);
  });

  it("filters by device_id", async () => {
    const rows = await getLocations(env.DB, { device_id: "device-a" });
    expect(rows.length).toBe(3);
    rows.forEach((row) => {
      const geojson = JSON.parse(row.geojson);
      expect(geojson.properties.device_id).toBe("device-a");
    });
  });

  it("filters by date", async () => {
    const rows = await getLocations(env.DB, { date: "2026-02-01" });
    expect(rows.length).toBe(3);
    rows.forEach((row) => {
      const geojson = JSON.parse(row.geojson);
      expect(geojson.properties.timestamp.startsWith("2026-02-01")).toBe(true);
    });
  });

  it("filters by from/to range", async () => {
    const rows = await getLocations(env.DB, {
      from: "2026-02-01T11:00:00Z",
      to: "2026-02-01T13:00:00Z",
    });
    expect(rows.length).toBe(2);
  });

  it("filters by bounding box", async () => {
    const rows = await getLocations(env.DB, {
      bbox: {
        sw_lon: 139.6,
        sw_lat: 35.5,
        ne_lon: 139.9,
        ne_lat: 35.8,
      },
    });
    // (139.7, 35.6) and (139.8, 35.7) are within bbox
    // (140.0, 36.0) and (139.5, 35.5) are outside
    expect(rows.length).toBe(2);
  });

  it("applies limit", async () => {
    const rows = await getLocations(env.DB, { limit: 2 });
    expect(rows.length).toBe(2);
  });

  it("orders by recorded_at DESC", async () => {
    const rows = await getLocations(env.DB, {});
    const timestamps = rows.map((r) => JSON.parse(r.geojson).properties.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1] >= timestamps[i]).toBe(true);
    }
  });

  it("combines multiple filters", async () => {
    const rows = await getLocations(env.DB, {
      device_id: "device-a",
      date: "2026-02-01",
    });
    expect(rows.length).toBe(2);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { handleGetLocations } from "../../src/handlers/get-locations";
import { insertLocations } from "../../src/db/queries";

const createFeature = (
  lon: number,
  lat: number,
  timestamp: string,
  device_id: string
) => ({
  type: "Feature" as const,
  geometry: { type: "Point" as const, coordinates: [lon, lat] },
  properties: { timestamp, device_id },
});

describe("handleGetLocations", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM locations");

    // Insert test data
    const testData = [
      createFeature(139.7, 35.6, "2026-02-01T10:00:00Z", "device-a"),
      createFeature(139.8, 35.7, "2026-02-01T12:00:00Z", "device-a"),
      createFeature(140.0, 36.0, "2026-02-02T10:00:00Z", "device-b"),
    ];

    await insertLocations(
      env.DB,
      testData.map((f) => ({
        device_id: f.properties.device_id,
        geojson: JSON.stringify(f),
      }))
    );
  });

  it("returns GeoJSON FeatureCollection by default", async () => {
    const request = new Request("http://localhost/api/locations");
    const response = await handleGetLocations(request, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const json = await response.json();
    expect(json.type).toBe("FeatureCollection");
    expect(json.features.length).toBe(3);
  });

  it("filters by date parameter", async () => {
    const request = new Request("http://localhost/api/locations?date=2026-02-01");
    const response = await handleGetLocations(request, env);

    const json = await response.json();
    expect(json.features.length).toBe(2);
  });

  it("filters by device_id parameter", async () => {
    const request = new Request("http://localhost/api/locations?device_id=device-a");
    const response = await handleGetLocations(request, env);

    const json = await response.json();
    expect(json.features.length).toBe(2);
  });

  it("returns JSONL format when requested", async () => {
    const request = new Request("http://localhost/api/locations?format=jsonl");
    const response = await handleGetLocations(request, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");

    const text = await response.text();
    const lines = text.split("\n").filter(Boolean);
    expect(lines.length).toBe(3);

    // Each line should be valid JSON
    lines.forEach((line) => {
      const parsed = JSON.parse(line);
      expect(parsed.type).toBe("Feature");
    });
  });

  it("returns raw JSON array when format=json", async () => {
    const request = new Request("http://localhost/api/locations?format=json");
    const response = await handleGetLocations(request, env);

    expect(response.status).toBe(200);

    const json = await response.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBe(3);
    expect(json[0]).toHaveProperty("id");
    expect(json[0]).toHaveProperty("geojson");
  });

  it("applies limit parameter", async () => {
    const request = new Request("http://localhost/api/locations?limit=1");
    const response = await handleGetLocations(request, env);

    const json = await response.json();
    expect(json.features.length).toBe(1);
  });

  it("returns error for invalid query parameters", async () => {
    const request = new Request("http://localhost/api/locations?date=invalid");
    const response = await handleGetLocations(request, env);

    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.result).toBe("error");
    expect(json.error).toBe("invalid_query_params");
  });

  it("filters by bbox parameter", async () => {
    // bbox: sw_lon,sw_lat,ne_lon,ne_lat
    const request = new Request("http://localhost/api/locations?bbox=139.6,35.5,139.9,35.8");
    const response = await handleGetLocations(request, env);

    const json = await response.json();
    // Only (139.7, 35.6) and (139.8, 35.7) are within bbox
    expect(json.features.length).toBe(2);
  });
});

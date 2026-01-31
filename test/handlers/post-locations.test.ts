import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { handlePostLocations } from "../../src/handlers/post-locations";

const createValidPayload = (locations: Array<{
  lon: number;
  lat: number;
  timestamp: string;
  device_id?: string;
}>) => ({
  locations: locations.map((loc) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [loc.lon, loc.lat],
    },
    properties: {
      timestamp: loc.timestamp,
      device_id: loc.device_id,
    },
  })),
});

describe("handlePostLocations", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM locations");
  });

  it("returns ok for valid payload", async () => {
    const payload = createValidPayload([
      { lon: 139.7, lat: 35.6, timestamp: "2026-02-01T10:00:00Z", device_id: "test-device" },
    ]);

    const request = new Request("http://localhost/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await handlePostLocations(request, env);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toEqual({ result: "ok" });

    // Verify data was inserted
    const rows = await env.DB.prepare("SELECT * FROM locations").all();
    expect(rows.results.length).toBe(1);
  });

  it("inserts multiple locations", async () => {
    const payload = createValidPayload([
      { lon: 139.7, lat: 35.6, timestamp: "2026-02-01T10:00:00Z", device_id: "device-1" },
      { lon: 139.8, lat: 35.7, timestamp: "2026-02-01T10:05:00Z", device_id: "device-1" },
    ]);

    const request = new Request("http://localhost/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await handlePostLocations(request, env);
    expect(response.status).toBe(200);

    const rows = await env.DB.prepare("SELECT * FROM locations").all();
    expect(rows.results.length).toBe(2);
  });

  it("returns error for invalid JSON", async () => {
    const request = new Request("http://localhost/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    const response = await handlePostLocations(request, env);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.result).toBe("error");
    expect(json.error).toBe("invalid_json");
  });

  it("returns error for invalid payload structure", async () => {
    const request = new Request("http://localhost/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invalid: "payload" }),
    });

    const response = await handlePostLocations(request, env);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.result).toBe("error");
    expect(json.error).toBe("validation_failed");
  });

  it("returns error for invalid Feature geometry", async () => {
    const request = new Request("http://localhost/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
            properties: { timestamp: "2026-02-01T10:00:00Z" },
          },
        ],
      }),
    });

    const response = await handlePostLocations(request, env);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.result).toBe("error");
    expect(json.error).toBe("validation_failed");
  });

  it("uses 'unknown' as device_id when not provided", async () => {
    const payload = createValidPayload([
      { lon: 139.7, lat: 35.6, timestamp: "2026-02-01T10:00:00Z" },
    ]);

    const request = new Request("http://localhost/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await handlePostLocations(request, env);
    expect(response.status).toBe(200);

    const row = await env.DB.prepare("SELECT device_id FROM locations").first();
    expect(row?.device_id).toBe("unknown");
  });
});

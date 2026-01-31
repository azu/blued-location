import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { insertLocations } from "../../src/db/queries";

describe("API Routes Integration", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM locations");
  });

  describe("Authentication", () => {
    it("returns 401 without Authorization header", async () => {
      const response = await SELF.fetch("http://localhost/api/locations");
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error).toBe("missing_authorization_header");
    });

    it("returns 401 with invalid token", async () => {
      const response = await SELF.fetch("http://localhost/api/locations", {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error).toBe("invalid_token");
    });

    it("returns 401 with invalid format", async () => {
      const response = await SELF.fetch("http://localhost/api/locations", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error).toBe("invalid_authorization_format");
    });

    it("allows request with valid token", async () => {
      const response = await SELF.fetch("http://localhost/api/locations", {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });
      expect(response.status).toBe(200);
    });
  });

  describe("POST /api/locations", () => {
    it("accepts valid Overland payload and stores data", async () => {
      const payload = {
        locations: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [139.7099, 35.6476] },
            properties: {
              timestamp: "2026-02-01T14:30:00Z",
              device_id: "iphone-test",
              altitude: 40,
              speed: 1.2,
            },
          },
        ],
      };

      const response = await SELF.fetch("http://localhost/api/locations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.result).toBe("ok");

      // Verify data was stored
      const rows = await env.DB.prepare("SELECT * FROM locations").all();
      expect(rows.results.length).toBe(1);
    });
  });

  describe("GET /api/locations", () => {
    beforeEach(async () => {
      // Insert test data
      const testData = [
        {
          device_id: "device-a",
          geojson: JSON.stringify({
            type: "Feature",
            geometry: { type: "Point", coordinates: [139.7, 35.6] },
            properties: { timestamp: "2026-02-01T10:00:00Z", device_id: "device-a" },
          }),
        },
        {
          device_id: "device-a",
          geojson: JSON.stringify({
            type: "Feature",
            geometry: { type: "Point", coordinates: [139.8, 35.7] },
            properties: { timestamp: "2026-02-01T12:00:00Z", device_id: "device-a" },
          }),
        },
      ];
      await insertLocations(env.DB, testData);
    });

    it("returns GeoJSON FeatureCollection", async () => {
      const response = await SELF.fetch("http://localhost/api/locations", {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.type).toBe("FeatureCollection");
      expect(json.features.length).toBe(2);
    });

    it("returns JSONL when format=jsonl", async () => {
      const response = await SELF.fetch("http://localhost/api/locations?format=jsonl", {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");

      const text = await response.text();
      const lines = text.split("\n").filter(Boolean);
      expect(lines.length).toBe(2);
    });

    it("filters by date", async () => {
      const response = await SELF.fetch("http://localhost/api/locations?date=2026-02-01", {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.features.length).toBe(2);
    });
  });

  describe("Other routes", () => {
    it("returns 404 for unknown API routes", async () => {
      const response = await SELF.fetch("http://localhost/api/unknown", {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });
      expect(response.status).toBe(404);
    });

    it("returns 405 for unsupported methods", async () => {
      const response = await SELF.fetch("http://localhost/api/locations", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });
      expect(response.status).toBe(405);
    });
  });
});

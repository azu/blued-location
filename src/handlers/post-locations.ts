import * as v from "valibot";
import { OverlandPayload, type FeatureType } from "../schemas/overland";
import { insertLocations } from "../db/queries";
import {
  reverseGeocode,
  groupPointsByDistance,
  sleep,
  type PointWithIndex,
  type NominatimConfig,
  type ReverseGeocodeResult,
} from "../services/nominatim";

type Env = {
  DB: D1Database;
  NOMINATIM_USER_AGENT?: string;
  NOMINATIM_EMAIL?: string;
};

type ApiResponse =
  | { result: "ok" }
  | { result: "error"; error: string; details?: unknown };

function jsonResponse(data: ApiResponse, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handlePostLocations(
  request: Request,
  env: Env
): Promise<Response> {
  // 1. Parse JSON
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ result: "error", error: "invalid_json" }, 400);
  }

  // 2. Validate with Valibot
  const parseResult = v.safeParse(OverlandPayload, body);
  if (!parseResult.success) {
    return jsonResponse(
      {
        result: "error",
        error: "validation_failed",
        details: parseResult.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join("."),
          message: i.message,
        })),
      },
      400
    );
  }

  // 3. Transform and prepare locations
  try {
    const features = parseResult.output.locations;
    const locationData: { device_id: string; geojson: string; address: string | null; poi: string | null }[] = features.map((feature: FeatureType) => {
      const device_id = feature.properties.device_id ?? "unknown";
      return {
        device_id,
        geojson: JSON.stringify(feature),
        address: null,
        poi: null,
      };
    });

    // 4. Reverse geocode stationary points if NOMINATIM_USER_AGENT is configured
    if (env.NOMINATIM_USER_AGENT) {
      const nominatimConfig: NominatimConfig = {
        userAgent: env.NOMINATIM_USER_AGENT,
        email: env.NOMINATIM_EMAIL,
      };

      // Extract stationary points with their indices
      const stationaryPoints: PointWithIndex<number>[] = [];
      for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        const motion = feature.properties.motion ?? [];
        if (motion.includes("stationary")) {
          const [lon, lat] = feature.geometry.coordinates;
          stationaryPoints.push({ index: i, lat, lon, data: i });
        }
      }

      // Group stationary points within 50m
      const groups = groupPointsByDistance(stationaryPoints, 50);

      // Reverse geocode each group's representative point
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        const representative = group[0];

        const result = await reverseGeocode(representative.lat, representative.lon, nominatimConfig);

        // Apply result to all points in the group
        if (result) {
          for (const point of group) {
            locationData[point.index].address = result.address;
            locationData[point.index].poi = result.poi;
          }
        }

        // Rate limit: wait 1 second between requests (except for last group)
        if (g < groups.length - 1) {
          await sleep(1000);
        }
      }
    }

    // 5. Insert to DB
    await insertLocations(env.DB, locationData);
    return jsonResponse({ result: "ok" });
  } catch (err) {
    console.error("DB insert error:", err);
    return jsonResponse({ result: "error", error: "database_error" }, 500);
  }
}

import * as v from "valibot";
import { OverlandPayload, type FeatureType } from "../schemas/overland";
import { insertLocations } from "../db/queries";

type Env = {
  DB: D1Database;
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

  // 3. Transform and insert to DB
  try {
    const locations = parseResult.output.locations.map((feature: FeatureType) => {
      // Use device_id from properties, or default to "unknown"
      const device_id = feature.properties.device_id ?? "unknown";
      return {
        device_id,
        geojson: JSON.stringify(feature),
      };
    });

    await insertLocations(env.DB, locations);
    return jsonResponse({ result: "ok" });
  } catch (err) {
    console.error("DB insert error:", err);
    return jsonResponse({ result: "error", error: "database_error" }, 500);
  }
}

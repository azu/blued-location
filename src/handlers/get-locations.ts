import * as v from "valibot";
import { GetLocationsQuery, parseBbox } from "../schemas/query";
import { getLocations } from "../db/queries";
import type { GetLocationsParams } from "../db/types";

type Env = {
  DB: D1Database;
};

type ApiErrorResponse = { result: "error"; error: string; details?: unknown };

function jsonResponse(data: unknown, status = 200, contentType = "application/json"): Response {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

export async function handleGetLocations(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const rawParams = Object.fromEntries(url.searchParams.entries());

  // Validate query parameters
  const parseResult = v.safeParse(GetLocationsQuery, rawParams);
  if (!parseResult.success) {
    const errorResponse: ApiErrorResponse = {
      result: "error",
      error: "invalid_query_params",
      details: parseResult.issues.map((i) => ({
        path: i.path?.map((p) => p.key).join("."),
        message: i.message,
      })),
    };
    return jsonResponse(errorResponse, 400);
  }

  const query = parseResult.output;

  // Build params for getLocations
  const params: GetLocationsParams = {};

  if (query.device_id) {
    params.device_id = query.device_id;
  }
  if (query.from) {
    params.from = query.from;
  }
  if (query.to) {
    params.to = query.to;
  }
  if (query.bbox) {
    params.bbox = parseBbox(query.bbox);
  }
  if (query.limit) {
    params.limit = query.limit;
  }

  try {
    const rows = await getLocations(env.DB, params);
    const format = query.format ?? "geojson";

    if (format === "jsonl") {
      // JSONL: one Feature per line
      const lines = rows.map((row) => row.geojson).join("\n");
      return jsonResponse(lines, 200, "application/x-ndjson");
    }

    if (format === "json") {
      // Raw array
      return jsonResponse(rows);
    }

    // Default: GeoJSON FeatureCollection
    const features = rows.map((row) => JSON.parse(row.geojson));
    const featureCollection = {
      type: "FeatureCollection",
      features,
    };
    return jsonResponse(featureCollection);
  } catch (err) {
    console.error("DB query error:", err);
    return jsonResponse({ result: "error", error: "database_error" }, 500);
  }
}

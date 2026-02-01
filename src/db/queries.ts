import type { LocationInsert, GetLocationsParams } from "./types";

export async function insertLocations(
  db: D1Database,
  locations: LocationInsert[]
): Promise<{ count: number }> {
  if (locations.length === 0) {
    return { count: 0 };
  }

  const stmt = db.prepare("INSERT INTO locations (device_id, geojson, address, poi) VALUES (?, ?, ?, ?)");
  const batch = locations.map((loc) => stmt.bind(loc.device_id, loc.geojson, loc.address ?? null, loc.poi ?? null));
  await db.batch(batch);

  return { count: locations.length };
}

export async function getLocations(
  db: D1Database,
  params: GetLocationsParams
): Promise<{ id: number; geojson: string; address: string | null; poi: string | null }[]> {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (params.device_id) {
    conditions.push("device_id = ?");
    bindings.push(params.device_id);
  }

  if (params.from) {
    conditions.push("recorded_at >= ?");
    bindings.push(params.from);
  }

  if (params.to) {
    conditions.push("recorded_at <= ?");
    bindings.push(params.to);
  }

  if (params.bbox) {
    conditions.push("lon >= ? AND lon <= ?");
    bindings.push(params.bbox.sw_lon, params.bbox.ne_lon);
    conditions.push("lat >= ? AND lat <= ?");
    bindings.push(params.bbox.sw_lat, params.bbox.ne_lat);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = params.limit ?? 1000;

  const sql = `SELECT id, geojson, address, poi FROM locations ${where} ORDER BY recorded_at DESC LIMIT ?`;
  bindings.push(limit);

  const result = await db.prepare(sql).bind(...bindings).all<{ id: number; geojson: string; address: string | null; poi: string | null }>();
  return result.results;
}

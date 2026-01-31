import * as v from "valibot";

const DateString = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
// JS ISO format: 2026-02-01T10:00:00.000Z (milliseconds and Z required)
const IsoDateTimeString = v.pipe(v.string(), v.isoTimestamp());
const BboxString = v.pipe(
  v.string(),
  v.regex(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
);
const FormatString = v.picklist(["geojson", "json", "jsonl"]);

export const GetLocationsQuery = v.object({
  date: v.optional(DateString),
  from: v.optional(IsoDateTimeString),
  to: v.optional(IsoDateTimeString),
  bbox: v.optional(BboxString),
  limit: v.optional(v.pipe(v.string(), v.transform((s) => parseInt(s, 10)))),
  format: v.optional(FormatString),
  device_id: v.optional(v.string()),
});

export type GetLocationsQueryType = v.InferOutput<typeof GetLocationsQuery>;

export function parseBbox(bbox: string): {
  sw_lon: number;
  sw_lat: number;
  ne_lon: number;
  ne_lat: number;
} {
  const [sw_lon, sw_lat, ne_lon, ne_lat] = bbox.split(",").map(Number);
  return { sw_lon, sw_lat, ne_lon, ne_lat };
}

import * as v from "valibot";

const PointGeometry = v.object({
  type: v.literal("Point"),
  coordinates: v.tuple([v.number(), v.number()]), // [lon, lat]
});

const FeatureProperties = v.object({
  timestamp: v.string(),
  device_id: v.optional(v.string()),
  altitude: v.optional(v.number()),
  speed: v.optional(v.number()),
  horizontal_accuracy: v.optional(v.number()),
  vertical_accuracy: v.optional(v.number()),
  speed_accuracy: v.optional(v.number()),
  course: v.optional(v.number()),
  battery_level: v.optional(v.number()),
  battery_state: v.optional(v.string()),
  motion: v.optional(v.array(v.string())),
  wifi: v.optional(v.string()),
  unique_id: v.optional(v.string()),
});

const Feature = v.object({
  type: v.literal("Feature"),
  geometry: PointGeometry,
  properties: FeatureProperties,
});

export const OverlandPayload = v.object({
  locations: v.array(Feature),
  current: v.optional(v.unknown()),
  trip: v.optional(v.unknown()),
});

export type OverlandPayloadType = v.InferOutput<typeof OverlandPayload>;
export type FeatureType = v.InferOutput<typeof Feature>;

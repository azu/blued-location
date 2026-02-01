export type LocationInsert = {
  device_id: string;
  geojson: string;
};

export type LocationRow = {
  id: number;
  device_id: string;
  geojson: string;
  lon: number;
  lat: number;
  altitude: number | null;
  speed: number | null;
  accuracy: number | null;
  battery: number | null;
  recorded_at: string;
  created_at: string;
};

export type GetLocationsParams = {
  device_id?: string;
  from?: string;
  to?: string;
  bbox?: {
    sw_lon: number;
    sw_lat: number;
    ne_lon: number;
    ne_lat: number;
  };
  limit?: number;
};

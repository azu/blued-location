export type NominatimConfig = {
  userAgent: string;
  email?: string;
  baseUrl?: string;
};

export type NominatimAddress = {
  amenity?: string;
  shop?: string;
  tourism?: string;
  building?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  country?: string;
  postcode?: string;
};

export type NominatimResponse = {
  display_name: string;
  address: NominatimAddress;
};

export type ReverseGeocodeResult = {
  address: string;
  poi: string | null;
};

export type ReverseGeocodeOptions = {
  maxRetries?: number;
  initialDelayMs?: number;
};

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;

export async function reverseGeocode(
  lat: number,
  lon: number,
  config: NominatimConfig,
  options: ReverseGeocodeOptions = {}
): Promise<ReverseGeocodeResult | null> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;

  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const url = new URL("/reverse", baseUrl);
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", lat.toString());
  url.searchParams.set("lon", lon.toString());
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "ja");

  const headers: Record<string, string> = {
    "User-Agent": config.userAgent,
  };
  if (config.email) {
    headers["From"] = config.email;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url.toString(), { headers });

      // Rate limit handling (429 Too Many Requests)
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : initialDelayMs * Math.pow(2, attempt);
        console.warn(`Nominatim rate limit hit, retrying after ${delayMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(delayMs);
        continue;
      }

      // Server errors (5xx) - retry with backoff
      if (response.status >= 500) {
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        console.warn(`Nominatim server error ${response.status}, retrying after ${delayMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(delayMs);
        continue;
      }

      // Client errors (4xx except 429) - don't retry
      if (!response.ok) {
        console.error(`Nominatim API error: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as NominatimResponse;
      if (!data.display_name) {
        return null;
      }

      return {
        address: data.display_name,
        poi: extractPoi(data.address),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      console.warn(`Nominatim request failed: ${lastError.message}, retrying after ${delayMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
      await sleep(delayMs);
    }
  }

  console.error(`Nominatim API failed after ${maxRetries + 1} attempts`, lastError);
  return null;
}

function extractPoi(address: NominatimAddress): string | null {
  // POI優先順位: amenity → shop → tourism → building
  return address.amenity ?? address.shop ?? address.tourism ?? address.building ?? null;
}

// Haversine distance calculation (meters)
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Group points within threshold distance (default 50m)
export type PointWithIndex<T> = {
  index: number;
  lat: number;
  lon: number;
  data: T;
};

export function groupPointsByDistance<T>(
  points: PointWithIndex<T>[],
  thresholdMeters = 50
): PointWithIndex<T>[][] {
  if (points.length === 0) return [];

  const groups: PointWithIndex<T>[][] = [];
  const assigned = new Set<number>();

  for (const point of points) {
    if (assigned.has(point.index)) continue;

    const group: PointWithIndex<T>[] = [point];
    assigned.add(point.index);

    for (const other of points) {
      if (assigned.has(other.index)) continue;
      const distance = haversineDistance(point.lat, point.lon, other.lat, other.lon);
      if (distance <= thresholdMeters) {
        group.push(other);
        assigned.add(other.index);
      }
    }

    groups.push(group);
  }

  return groups;
}

// Sleep utility for rate limiting
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

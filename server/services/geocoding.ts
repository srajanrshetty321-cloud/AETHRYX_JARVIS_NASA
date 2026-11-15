import type { GeoBoundingBox, GeoPoint, GeoRegion } from '../../src/types/aethryx.ts';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const searchCache = new Map<string, CacheEntry<GeoRegion[]>>();
const reverseCache = new Map<string, CacheEntry<GeoRegion>>();

const NOMINATIM_HEADERS = {
  'User-Agent': 'AETHRYX-JARVIS/1.0 (NASA-Space-Apps-2026 Earth-System-Trend-Detective)',
  Accept: 'application/json',
};

export function validateLatLon(lat: number, lon: number): { valid: boolean; reason?: string } {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { valid: false, reason: 'Latitude and longitude must be finite numbers.' };
  }
  if (lat < -90 || lat > 90) {
    return { valid: false, reason: `Latitude ${lat} is out of valid range [-90, 90].` };
  }
  if (lon < -180 || lon > 180) {
    return { valid: false, reason: `Longitude ${lon} is out of valid range [-180, 180].` };
  }
  return { valid: true };
}

export function parseCoordinateQuery(query: string): { lat: number; lon: number } | null {
  const cleaned = query.trim();
  const match = cleaned.match(
    /^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i
  );
  if (!match) return null;
  let lat = Number(match[1]);
  const latHem = match[2]?.toUpperCase();
  let lon = Number(match[3]);
  const lonHem = match[4]?.toUpperCase();

  if (latHem === 'S' && lat > 0) lat = -lat;
  if (lonHem === 'W' && lon > 0) lon = -lon;

  const check = validateLatLon(lat, lon);
  return check.valid ? { lat, lon } : null;
}

export function computePolygonSummary(polygon: GeoPoint[]): {
  centroid: GeoPoint;
  bbox: GeoBoundingBox;
} {
  if (polygon.length === 0) {
    throw new Error('Polygon requires at least one coordinate.');
  }
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  let sumLat = 0;
  let sumLon = 0;

  for (const pt of polygon) {
    if (pt.lat < south) south = pt.lat;
    if (pt.lat > north) north = pt.lat;
    if (pt.lon < west) west = pt.lon;
    if (pt.lon > east) east = pt.lon;
    sumLat += pt.lat;
    sumLon += pt.lon;
  }

  return {
    centroid: {
      lat: Number((sumLat / polygon.length).toFixed(4)),
      lon: Number((sumLon / polygon.length).toFixed(4)),
    },
    bbox: {
      south: Number(south.toFixed(4)),
      north: Number(north.toFixed(4)),
      west: Number(west.toFixed(4)),
      east: Number(east.toFixed(4)),
    },
  };
}

function classifyOceanFromNominatim(data: Record<string, unknown>): boolean {
  if (data.error) return true;
  const category = String(data.category || data.class || '').toLowerCase();
  const type = String(data.type || '').toLowerCase();
  const display = String(data.display_name || '').toLowerCase();
  if (
    type === 'ocean' ||
    type === 'sea' ||
    type === 'bay' ||
    type === 'strait' ||
    (category === 'place' && (type === 'sea' || type === 'ocean'))
  ) {
    return true;
  }
  if (!data.address && (display.includes('ocean') || display.includes('sea'))) {
    return true;
  }
  return false;
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeoRegion> {
  const check = validateLatLon(lat, lon);
  if (!check.valid) {
    throw new Error(check.reason || 'Invalid coordinates');
  }
  const roundedLat = Number(lat.toFixed(4));
  const roundedLon = Number(lon.toFixed(4));
  const key = `${roundedLat},${roundedLon}`;
  const cached = reverseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${roundedLat}&lon=${roundedLon}&zoom=10&addressdetails=1`;
  try {
    const res = await fetch(url, {
      headers: NOMINATIM_HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      throw new Error(`Nominatim HTTP ${res.status}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    const isOcean = classifyOceanFromNominatim(data);
    const addr = (data.address as Record<string, string> | undefined) || {};
    const country = addr.country || (isOcean ? 'International Waters / Ocean' : undefined);
    const cityOrArea =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.county ||
      addr.state_district ||
      addr.state ||
      (isOcean ? `Marine Coordinate (${roundedLat.toFixed(2)}°, ${roundedLon.toFixed(2)}°)` : undefined);

    const name = cityOrArea
      ? country && !isOcean
        ? `${cityOrArea}, ${country}`
        : cityOrArea
      : `Location (${roundedLat.toFixed(2)}°, ${roundedLon.toFixed(2)}°)`;

    const displayName =
      typeof data.display_name === 'string' && data.display_name.length > 0
        ? data.display_name
        : isOcean
          ? `Open Ocean / Marine Zone (${roundedLat.toFixed(4)}°, ${roundedLon.toFixed(4)}°)`
          : name;

    const bboxArr = Array.isArray(data.boundingbox) ? (data.boundingbox as string[]) : null;
    const bbox: GeoBoundingBox = bboxArr && bboxArr.length === 4
      ? {
          south: Number(bboxArr[0]),
          north: Number(bboxArr[1]),
          west: Number(bboxArr[2]),
          east: Number(bboxArr[3]),
        }
      : {
          south: Number(Math.max(-90, roundedLat - 0.25).toFixed(4)),
          north: Number(Math.min(90, roundedLat + 0.25).toFixed(4)),
          west: Number(Math.max(-180, roundedLon - 0.25).toFixed(4)),
          east: Number(Math.min(180, roundedLon + 0.25).toFixed(4)),
        };

    const region: GeoRegion = {
      name,
      displayName,
      lat: roundedLat,
      lon: roundedLon,
      bbox,
      country,
      regionType: isOcean ? 'ocean' : String(data.type || data.category || 'point'),
      isOcean,
      source: 'OpenStreetMap Nominatim',
    };

    reverseCache.set(key, { value: region, expiresAt: Date.now() + 1000 * 60 * 30 });
    return region;
  } catch {
    return {
      name: `Coordinate (${roundedLat.toFixed(2)}°, ${roundedLon.toFixed(2)}°)`,
      displayName: `Geographic Coordinate ${roundedLat.toFixed(4)}°, ${roundedLon.toFixed(4)}°`,
      lat: roundedLat,
      lon: roundedLon,
      bbox: {
        south: Number(Math.max(-90, roundedLat - 0.25).toFixed(4)),
        north: Number(Math.min(90, roundedLat + 0.25).toFixed(4)),
        west: Number(Math.max(-180, roundedLon - 0.25).toFixed(4)),
        east: Number(Math.min(180, roundedLon + 0.25).toFixed(4)),
      },
      regionType: 'coordinate',
      isOcean: false,
      source: 'Direct Coordinate Fallback',
    };
  }
}

export async function searchGlobalRegions(query: string): Promise<GeoRegion[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const directCoord = parseCoordinateQuery(trimmed);
  if (directCoord) {
    const resolved = await reverseGeocode(directCoord.lat, directCoord.lon);
    return [resolved];
  }

  const cacheKey = trimmed.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    trimmed
  )}&format=jsonv2&addressdetails=1&limit=8`;

  const res = await fetch(url, {
    headers: NOMINATIM_HEADERS,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Global geocoding service returned HTTP ${res.status}`);
  }

  const raw = (await res.json()) as Array<Record<string, unknown>>;
  const regions: GeoRegion[] = raw.map((item) => {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const addr = (item.address as Record<string, string> | undefined) || {};
    const bboxArr = Array.isArray(item.boundingbox) ? (item.boundingbox as string[]) : null;
    const isOcean = classifyOceanFromNominatim(item);
    const primaryName =
      String(item.name || '').trim() ||
      addr.city ||
      addr.town ||
      addr.state ||
      String(item.display_name || '').split(',')[0] ||
      `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    const country = addr.country;
    const shortName = country && !primaryName.includes(country) ? `${primaryName}, ${country}` : primaryName;

    return {
      name: shortName,
      displayName: String(item.display_name || shortName),
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      bbox:
        bboxArr && bboxArr.length === 4
          ? {
              south: Number(Number(bboxArr[0]).toFixed(4)),
              north: Number(Number(bboxArr[1]).toFixed(4)),
              west: Number(Number(bboxArr[2]).toFixed(4)),
              east: Number(Number(bboxArr[3]).toFixed(4)),
            }
          : undefined,
      country,
      regionType: isOcean ? 'ocean' : String(item.type || item.category || 'place'),
      isOcean,
      source: 'OpenStreetMap Nominatim',
    };
  });

  searchCache.set(cacheKey, { value: regions, expiresAt: Date.now() + 1000 * 60 * 15 });
  return regions;
}

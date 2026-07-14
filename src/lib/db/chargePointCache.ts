import { get, set } from 'idb-keyval'
import { distanceMeters, METERS_PER_MILE, type LatLng } from '../geo/geoMath'
import type { ChargePoint } from '../domain'

const CACHE_KEY = 'wattson-charge-point-cache-v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days, matches the Android app

interface CachedChargePoint extends ChargePoint {
  cachedAt: number
}

interface BoundingBox {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

function boundingBox(center: LatLng, radiusMiles: number): BoundingBox {
  // ~1 degree latitude = 69 miles; longitude degrees shrink with cos(latitude).
  const latDelta = radiusMiles / 69.0
  const lonDelta = radiusMiles / (69.0 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.1))
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLon: center.lon - lonDelta,
    maxLon: center.lon + lonDelta,
  }
}

function withinBox(point: LatLng, box: BoundingBox): boolean {
  return point.lat >= box.minLat && point.lat <= box.maxLat && point.lon >= box.minLon && point.lon <= box.maxLon
}

async function loadAll(): Promise<CachedChargePoint[]> {
  return (await get<CachedChargePoint[]>(CACHE_KEY)) ?? []
}

/** Returns cached points within radiusMiles of center, plus whether the
 * freshest entry in that bounding box is still within the TTL. */
export async function getCached(
  center: LatLng,
  radiusMiles: number,
): Promise<{ points: ChargePoint[]; isFresh: boolean }> {
  const all = await loadAll()
  const box = boundingBox(center, radiusMiles)
  const inBox = all.filter((p) => withinBox(p.location, box))

  const mostRecentCachedAt = inBox.reduce((max, p) => Math.max(max, p.cachedAt), 0)
  const isFresh = mostRecentCachedAt > 0 && Date.now() - mostRecentCachedAt < CACHE_TTL_MS

  const radiusMeters = radiusMiles * METERS_PER_MILE
  const withinRadius = inBox.filter((p) => distanceMeters(center, p.location) <= radiusMeters)

  return { points: withinRadius, isFresh }
}

export async function upsertAll(points: ChargePoint[]): Promise<void> {
  const all = await loadAll()
  const byId = new Map(all.map((p) => [p.id, p]))
  const now = Date.now()
  for (const point of points) {
    byId.set(point.id, { ...point, cachedAt: now })
  }
  await set(CACHE_KEY, Array.from(byId.values()))
}

import type { LatLng } from '../geo/geoMath'

const OVERPASS_BASE_URL = 'https://overpass-api.de'

export interface OverpassElement {
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

interface OverpassResponse {
  elements: OverpassElement[]
}

function nearbyOutletsQuery(center: LatLng, radiusMeters: number): string {
  return `
    [out:json][timeout:25];
    (
      node["socket:device"="yes"](around:${radiusMeters},${center.lat},${center.lon});
      node["socket:nema_5_15"="yes"](around:${radiusMeters},${center.lat},${center.lon});
      node["electricity"="yes"]["public"="yes"](around:${radiusMeters},${center.lat},${center.lon});
    );
    out body;
  `.trim()
}

/** Only queries nodes: individual sockets are practically always mapped as
 * point features, not ways. Same tags as the Android app's OverpassApi. */
export async function getNearbyOutlets(center: LatLng, radiusMeters: number): Promise<OverpassElement[]> {
  const response = await fetch(`${OVERPASS_BASE_URL}/api/interpreter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(nearbyOutletsQuery(center, radiusMeters))}`,
  })
  if (!response.ok) throw new Error(`Overpass request failed (${response.status})`)

  const data: OverpassResponse = await response.json()
  return data.elements ?? []
}

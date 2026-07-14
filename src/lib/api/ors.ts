import type { LatLng } from '../geo/geoMath'
import type { RoutePolyline, RouteStep, GeocodeResult } from '../domain'

const ORS_BASE_URL = 'https://api.openrouteservice.org'
const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY as string

export const ORS_PROFILE_CYCLING_ROAD = 'cycling-road'

interface OrsDirectionsResponse {
  features: Array<{
    geometry: { coordinates: [number, number][] }
    properties: {
      summary: { distance: number; duration: number }
      segments?: Array<{
        steps: Array<{
          distance: number
          duration: number
          instruction: string
          way_points: [number, number]
        }>
      }>
    }
  }>
}

/** @param waypoints ordered list including origin and destination (and any
 * intermediate pitstops); ORS routes through all of them in order. */
export async function getRoute(
  waypoints: LatLng[],
  profile: string = ORS_PROFILE_CYCLING_ROAD,
): Promise<RoutePolyline> {
  if (waypoints.length < 2) throw new Error('Need at least an origin and destination')

  const response = await fetch(`${ORS_BASE_URL}/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Raw API key, not "Bearer <key>" — matches ORS's own convention.
      Authorization: ORS_API_KEY,
    },
    body: JSON.stringify({ coordinates: waypoints.map((w) => [w.lon, w.lat]) }),
  })
  if (!response.ok) {
    throw new Error(`ORS directions failed (${response.status}): ${await response.text()}`)
  }

  const data: OrsDirectionsResponse = await response.json()
  const feature = data.features[0]
  if (!feature) throw new Error('ORS returned no route for the given waypoints')

  const steps: RouteStep[] = (feature.properties.segments ?? []).flatMap((segment) =>
    segment.steps.map((step) => ({
      instruction: step.instruction,
      distanceMeters: step.distance,
      durationSeconds: step.duration,
      wayPointStart: step.way_points[0],
      wayPointEnd: step.way_points[1],
    })),
  )

  return {
    points: feature.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    distanceMeters: feature.properties.summary.distance,
    durationSeconds: feature.properties.summary.duration,
    steps,
  }
}

interface OrsGeocodeResponse {
  features: Array<{
    geometry: { coordinates: [number, number] }
    properties: { label: string }
  }>
}

/** Pelias-backed geocoding — same ORS API key, no separate signup. */
export async function geocodeSearch(query: string, size = 5): Promise<GeocodeResult[]> {
  if (!query.trim()) return []

  const url = new URL(`${ORS_BASE_URL}/geocode/search`)
  url.searchParams.set('api_key', ORS_API_KEY)
  url.searchParams.set('text', query)
  url.searchParams.set('size', String(size))

  const response = await fetch(url.toString())
  if (!response.ok) return []

  const data: OrsGeocodeResponse = await response.json()
  return data.features.map((f) => ({
    label: f.properties.label,
    location: { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] },
  }))
}

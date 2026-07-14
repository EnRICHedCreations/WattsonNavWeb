export interface LatLng {
  lat: number
  lon: number
}

const EARTH_RADIUS_METERS = 6_371_000
export const METERS_PER_MILE = 1609.344

const toRadians = (deg: number) => (deg * Math.PI) / 180
const toDegrees = (rad: number) => (rad * 180) / Math.PI

export function distanceMeters(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return EARTH_RADIUS_METERS * c
}

/** Initial great-circle bearing from a to b, in degrees (0 = north, clockwise). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const dLon = toRadians(b.lon - a.lon)

  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const theta = Math.atan2(y, x)
  return (toDegrees(theta) + 360) % 360
}

/** Linear interpolation between two points — fine at the scale of consecutive
 * route vertices, not meant for long spans. */
export function interpolate(a: LatLng, b: LatLng, fraction: number): LatLng {
  const f = Math.min(1, Math.max(0, fraction))
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
  }
}

/** Cumulative distance (meters) at each point in points, index-aligned. */
export function cumulativeDistances(points: LatLng[]): number[] {
  if (points.length === 0) return []
  const out: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + distanceMeters(points[i - 1], points[i]))
  }
  return out
}

/** Index of the closest point in points to target, or -1 if points is empty. */
export function nearestPointIndex(target: LatLng, points: LatLng[]): number {
  if (points.length === 0) return -1
  let bestIndex = 0
  let bestDistance = Number.MAX_VALUE
  for (let i = 0; i < points.length; i++) {
    const d = distanceMeters(target, points[i])
    if (d < bestDistance) {
      bestDistance = d
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * Walks a polyline and returns a point at every intervalMeters along its
 * length, excluding the very start and not overshooting the end. Used to
 * place charge markers every X miles.
 */
export function pointsAtInterval(points: LatLng[], intervalMeters: number): LatLng[] {
  if (intervalMeters <= 0) throw new Error('intervalMeters must be positive')
  if (points.length < 2) return []

  const cumulative = cumulativeDistances(points)
  const totalDistance = cumulative[cumulative.length - 1]
  const result: LatLng[] = []

  let target = intervalMeters
  let segmentIndex = 0

  while (target < totalDistance && segmentIndex < points.length - 1) {
    while (segmentIndex < points.length - 2 && cumulative[segmentIndex + 1] < target) {
      segmentIndex++
    }
    const segStart = cumulative[segmentIndex]
    const segEnd = cumulative[segmentIndex + 1]
    const segLength = segEnd - segStart
    const fraction = segLength > 0 ? (target - segStart) / segLength : 0

    result.push(interpolate(points[segmentIndex], points[segmentIndex + 1], fraction))
    target += intervalMeters
  }

  return result
}

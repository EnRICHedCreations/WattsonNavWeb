import { describe, it, expect, vi } from 'vitest'
import type { ChargePoint } from '../domain'
import type { LatLng } from '../geo/geoMath'

// Fake ORS: densifies each requested leg and sums haversine distance, mirroring
// FakeOrsApi in the Kotlin test suite. Kept self-contained (no outer-scope
// references) since vi.mock factories are hoisted above imports.
vi.mock('../api/ors', () => {
  const EARTH_RADIUS_METERS = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dist = (a: LatLng, b: LatLng) => {
    const lat1 = toRad(a.lat)
    const lat2 = toRad(b.lat)
    const dLat = toRad(b.lat - a.lat)
    const dLon = toRad(b.lon - a.lon)
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  }
  const POINTS_PER_LEG = 20

  return {
    ORS_PROFILE_CYCLING_ROAD: 'cycling-road',
    getRoute: vi.fn(async (waypoints: LatLng[]) => {
      const densified: LatLng[] = []
      for (let i = 0; i < waypoints.length - 1; i++) {
        const a = waypoints[i]
        const b = waypoints[i + 1]
        for (let step = 0; step <= POINTS_PER_LEG; step++) {
          const f = step / POINTS_PER_LEG
          densified.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f })
        }
      }
      let totalDistance = 0
      for (let i = 1; i < densified.length; i++) {
        totalDistance += dist(densified[i - 1], densified[i])
      }
      return {
        points: densified,
        distanceMeters: totalDistance,
        durationSeconds: totalDistance / 5,
        steps: [],
      }
    }),
  }
})

// Fake charge point repository: one deterministic station near whatever point
// was queried, mirroring FakeNlrApi's behavior in the Kotlin suite.
vi.mock('../repository/chargePointRepository', () => ({
  chargePointsNear: vi.fn(async (center: LatLng): Promise<ChargePoint[]> => {
    const id = `NLR:${Math.round(center.lat * 1e6)}:${Math.round(center.lon * 1e6)}`
    return [
      {
        id,
        name: `Station ${id}`,
        location: { lat: center.lat + 0.001, lon: center.lon + 0.001 },
        source: 'NLR',
        connectorTypes: ['J1772'],
        networkName: 'TestNetwork',
      },
    ]
  }),
}))

const { plan } = await import('../pitstopPlanner')

describe('pitstopPlanner', () => {
  it('short trip under one interval has no pitstops', async () => {
    // ~11km apart — well under a 20-mile (32km) interval.
    const result = await plan({
      origin: { lat: 0, lon: 0 },
      destination: { lat: 0.1, lon: 0 },
      chargeIntervalMiles: 20,
    })
    expect(result.pitstops).toHaveLength(0)
  })

  it('long trip generates multiple pitstops with unique stations', async () => {
    // Roughly 1 degree of longitude at the equator ≈ 111km ≈ 69 miles.
    const result = await plan({
      origin: { lat: 0, lon: 0 },
      destination: { lat: 0, lon: 1 },
      chargeIntervalMiles: 20,
    })
    expect(result.pitstops.length).toBeGreaterThanOrEqual(2)

    const ids = result.pitstops.map((p) => p.chargePoint.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('pitstops are ordered by increasing distance from start', async () => {
    const result = await plan({
      origin: { lat: 0, lon: 0 },
      destination: { lat: 0, lon: 1 },
      chargeIntervalMiles: 20,
    })
    const distances = result.pitstops.map((p) => p.distanceFromStartMeters)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
  })
})

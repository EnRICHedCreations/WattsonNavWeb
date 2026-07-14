import { describe, it, expect } from 'vitest'
import {
  distanceMeters,
  bearingDegrees,
  nearestPointIndex,
  cumulativeDistances,
  pointsAtInterval,
  interpolate,
  type LatLng,
} from './geoMath'

describe('geoMath', () => {
  it('distanceMeters between identical points is zero', () => {
    const point: LatLng = { lat: 42.6526, lon: -73.7562 }
    expect(distanceMeters(point, point)).toBeCloseTo(0, 3)
  })

  it('distanceMeters matches a known reference distance', () => {
    // Albany, NY to New York, NY — roughly 210 km great-circle.
    const albany: LatLng = { lat: 42.6526, lon: -73.7562 }
    const nyc: LatLng = { lat: 40.7128, lon: -74.006 }
    const distanceKm = distanceMeters(albany, nyc) / 1000
    expect(Math.abs(distanceKm - 210)).toBeLessThan(10)
  })

  it('bearingDegrees due north is zero', () => {
    const south: LatLng = { lat: 0, lon: 0 }
    const north: LatLng = { lat: 1, lon: 0 }
    expect(bearingDegrees(south, north)).toBeCloseTo(0, 0)
  })

  it('bearingDegrees due east is ninety', () => {
    const west: LatLng = { lat: 0, lon: 0 }
    const east: LatLng = { lat: 0, lon: 1 }
    expect(bearingDegrees(west, east)).toBeCloseTo(90, 0)
  })

  it('bearingDegrees stays within zero to 360', () => {
    const a: LatLng = { lat: 10, lon: 10 }
    const b: LatLng = { lat: 9, lon: 9 }
    const bearing = bearingDegrees(a, b)
    expect(bearing).toBeGreaterThanOrEqual(0)
    expect(bearing).toBeLessThanOrEqual(360)
  })

  it('nearestPointIndex returns -1 for empty array', () => {
    expect(nearestPointIndex({ lat: 0, lon: 0 }, [])).toBe(-1)
  })

  it('nearestPointIndex finds the closest of several points', () => {
    const points: LatLng[] = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 2, lon: 2 },
    ]
    const target: LatLng = { lat: 1.05, lon: 1.05 }
    expect(nearestPointIndex(target, points)).toBe(1)
  })

  it('cumulativeDistances starts at zero and is monotonically increasing', () => {
    const points: LatLng[] = [
      { lat: 0, lon: 0 },
      { lat: 0.01, lon: 0 },
      { lat: 0.02, lon: 0 },
      { lat: 0.03, lon: 0 },
    ]
    const cumulative = cumulativeDistances(points)
    expect(cumulative.length).toBe(points.length)
    expect(cumulative[0]).toBeCloseTo(0, 3)
    for (let i = 1; i < cumulative.length; i++) {
      expect(cumulative[i]).toBeGreaterThanOrEqual(cumulative[i - 1])
    }
  })

  it('cumulativeDistances of empty array is empty', () => {
    expect(cumulativeDistances([])).toEqual([])
  })

  it('pointsAtInterval places a marker roughly every interval along a straight line', () => {
    const points: LatLng[] = Array.from({ length: 101 }, (_, i) => ({ lat: i * 0.0001, lon: 0 }))
    const totalDistance = cumulativeDistances(points).at(-1)!
    const intervalMeters = totalDistance / 4
    const markers = pointsAtInterval(points, intervalMeters)

    expect(markers.length).toBe(3)
    for (const marker of markers) {
      expect(marker.lat).toBeGreaterThan(points[0].lat)
      expect(marker.lat).toBeLessThan(points.at(-1)!.lat)
    }
  })

  it('pointsAtInterval returns empty array when route is shorter than one interval', () => {
    const points: LatLng[] = [
      { lat: 0, lon: 0 },
      { lat: 0.0001, lon: 0 },
    ]
    expect(pointsAtInterval(points, 50_000)).toEqual([])
  })

  it('interpolate at fraction zero returns the start point', () => {
    const a: LatLng = { lat: 10, lon: 20 }
    const b: LatLng = { lat: 20, lon: 30 }
    const result = interpolate(a, b, 0)
    expect(result.lat).toBeCloseTo(a.lat, 4)
    expect(result.lon).toBeCloseTo(a.lon, 4)
  })

  it('interpolate at fraction one returns the end point', () => {
    const a: LatLng = { lat: 10, lon: 20 }
    const b: LatLng = { lat: 20, lon: 30 }
    const result = interpolate(a, b, 1)
    expect(result.lat).toBeCloseTo(b.lat, 4)
    expect(result.lon).toBeCloseTo(b.lon, 4)
  })

  it('interpolate at fraction half is the midpoint', () => {
    const a: LatLng = { lat: 10, lon: 20 }
    const b: LatLng = { lat: 20, lon: 30 }
    const result = interpolate(a, b, 0.5)
    expect(result.lat).toBeCloseTo(15, 4)
    expect(result.lon).toBeCloseTo(25, 4)
  })
})

import {
  cumulativeDistances,
  distanceMeters,
  pointsAtInterval,
  METERS_PER_MILE,
  type LatLng,
} from './geo/geoMath'
import type { ChargePoint, ChargeStationFilter, Pitstop, PitstopPlan } from './domain'
import { getRoute, ORS_PROFILE_CYCLING_ROAD } from './api/ors'
import { chargePointsNear } from './repository/chargePointRepository'

const SEARCH_RADII_MILES = [1.0, 3.0, 8.0]

/** Expands the search radius until it finds an unused station, since dense
 * urban markers might have plenty nearby but rural ones may not. */
async function findNearestStation(
  marker: LatLng,
  excludeIds: Set<string>,
  stationFilter: ChargeStationFilter,
): Promise<ChargePoint | null> {
  for (const radius of SEARCH_RADII_MILES) {
    const candidates = (await chargePointsNear(marker, radius, stationFilter)).filter(
      (c) => !excludeIds.has(c.id),
    )
    if (candidates.length === 0) continue

    let nearest = candidates[0]
    let nearestDistance = distanceMeters(marker, nearest.location)
    for (const candidate of candidates.slice(1)) {
      const d = distanceMeters(marker, candidate.location)
      if (d < nearestDistance) {
        nearest = candidate
        nearestDistance = d
      }
    }
    return nearest
  }
  return null
}

export interface PlanOptions {
  origin: LatLng
  destination: LatLng
  chargeIntervalMiles: number
  profile?: string
  /** Station IDs to never re-select — used when rerouting mid-trip so a
   * pitstop already passed can't be suggested again. */
  excludeChargePointIds?: Set<string>
  stationFilter?: ChargeStationFilter
}

/**
 * Plans a route from origin to destination with a charge pitstop roughly
 * every chargeIntervalMiles:
 *  1. Get the base route.
 *  2. Walk its polyline and drop a marker every X miles.
 *  3. For each marker, search an expanding radius for the nearest charge point.
 *  4. Skip a marker if it resolves to a station already chosen for a
 *     previous marker.
 *  5. Re-request the route through origin -> pitstops -> destination in
 *     order, so the final geometry reflects the actual detours.
 */
export async function plan(options: PlanOptions): Promise<PitstopPlan> {
  const {
    origin,
    destination,
    chargeIntervalMiles,
    profile = ORS_PROFILE_CYCLING_ROAD,
    excludeChargePointIds = new Set<string>(),
    stationFilter = 'BOTH',
  } = options

  if (chargeIntervalMiles <= 0) throw new Error('chargeIntervalMiles must be positive')

  const baseRoute = await getRoute([origin, destination], profile)

  // If the whole trip is shorter than one interval, no pitstops needed.
  if (baseRoute.distanceMeters <= chargeIntervalMiles * METERS_PER_MILE) {
    return { route: baseRoute, pitstops: [] }
  }

  const intervalMeters = chargeIntervalMiles * METERS_PER_MILE
  const markers = pointsAtInterval(baseRoute.points, intervalMeters)

  const chosenStations: ChargePoint[] = []
  for (const marker of markers) {
    const excluded = new Set([...excludeChargePointIds, ...chosenStations.map((s) => s.id)])
    const station = await findNearestStation(marker, excluded, stationFilter)
    if (station) chosenStations.push(station)
  }

  if (chosenStations.length === 0) {
    // No stations found anywhere along the corridor — surface the base route
    // rather than failing outright; the UI should tell the rider no pitstops
    // were found so they can adjust the interval or route manually.
    return { route: baseRoute, pitstops: [] }
  }

  const finalWaypoints = [origin, ...chosenStations.map((s) => s.location), destination]
  const finalRoute = await getRoute(finalWaypoints, profile)
  const cumulative = cumulativeDistances(finalRoute.points)

  const pitstops: Pitstop[] = chosenStations.map((station) => {
    let nearestIndex = 0
    let nearestDistance = Number.MAX_VALUE
    finalRoute.points.forEach((point, index) => {
      const d = distanceMeters(point, station.location)
      if (d < nearestDistance) {
        nearestDistance = d
        nearestIndex = index
      }
    })
    return { chargePoint: station, distanceFromStartMeters: cumulative[nearestIndex] ?? 0 }
  })

  return { route: finalRoute, pitstops }
}

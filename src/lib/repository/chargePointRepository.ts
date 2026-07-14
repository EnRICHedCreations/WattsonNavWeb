import { distanceMeters, METERS_PER_MILE, type LatLng } from '../geo/geoMath'
import type { ChargePoint, ChargeStationFilter } from '../domain'
import { filterIncludes } from '../domain'
import * as nlrApi from '../api/nlr'
import * as ocmApi from '../api/ocm'
import * as overpassApi from '../api/overpass'
import * as cache from '../db/chargePointCache'

const DEDUPE_RADIUS_METERS = 75.0

function describeOutlet(tags: Record<string, string>): string {
  if (tags['socket:device'] === 'yes') return 'Public device charging outlet'
  if (tags['socket:nema_5_15'] === 'yes') return 'Public wall outlet'
  return 'Public electricity access point'
}

/** NLR and OpenChargeMap both index the same physical stations independently,
 * so the same charger often shows up twice under different IDs. Treat entries
 * within DEDUPE_RADIUS_METERS of each other as the same station — prefer the
 * NLR record (government-maintained, generally more current) but union the
 * connector types from both, since neither source is consistently complete. */
function dedupe(nlr: ChargePoint[], ocm: ChargePoint[]): ChargePoint[] {
  const result = [...nlr]
  for (const candidate of ocm) {
    const matchIndex = result.findIndex(
      (p) => distanceMeters(p.location, candidate.location) < DEDUPE_RADIUS_METERS,
    )
    if (matchIndex === -1) {
      result.push(candidate)
    } else {
      const existing = result[matchIndex]
      result[matchIndex] = {
        ...existing,
        connectorTypes: Array.from(new Set([...existing.connectorTypes, ...candidate.connectorTypes])),
      }
    }
  }
  return result
}

async function fetchAndMerge(center: LatLng, radiusMiles: number): Promise<ChargePoint[]> {
  const [nlrResult, ocmResult, outletResult] = await Promise.allSettled([
    nlrApi.getNearbyStations(center, radiusMiles).then((stations) =>
      stations.map(
        (s): ChargePoint => ({
          id: `NLR:${s.id}`,
          name: s.station_name,
          location: { lat: s.latitude, lon: s.longitude },
          source: 'NLR',
          connectorTypes: s.ev_connector_types ?? [],
          networkName: s.ev_network,
        }),
      ),
    ),
    ocmApi.getNearby(center, radiusMiles).then((pois) =>
      pois.flatMap((poi): ChargePoint[] => {
        if (!poi.AddressInfo) return []
        return [
          {
            id: `OPEN_CHARGE_MAP:${poi.ID}`,
            name: poi.AddressInfo.Title ?? 'Unnamed station',
            location: { lat: poi.AddressInfo.Latitude, lon: poi.AddressInfo.Longitude },
            source: 'OPEN_CHARGE_MAP',
            connectorTypes: (poi.Connections ?? [])
              .map((c) => c.ConnectionType?.Title)
              .filter((t): t is string => !!t),
            networkName: poi.OperatorInfo?.Title ?? null,
          },
        ]
      }),
    ),
    overpassApi.getNearbyOutlets(center, radiusMiles * METERS_PER_MILE).then((elements) =>
      elements.flatMap((el): ChargePoint[] => {
        if (el.lat == null || el.lon == null) return []
        const tags = el.tags ?? {}
        return [
          {
            id: `PUBLIC_OUTLET:${el.id}`,
            name: tags.name ?? describeOutlet(tags),
            location: { lat: el.lat, lon: el.lon },
            source: 'PUBLIC_OUTLET',
            connectorTypes: ['NEMA 5-15 (standard wall outlet)'],
            networkName: 'Public outlet (OpenStreetMap) — slow charging',
          },
        ]
      }),
    ),
  ])

  if (nlrResult.status === 'rejected') console.warn('NLR fetch failed:', nlrResult.reason)
  if (ocmResult.status === 'rejected') console.warn('OpenChargeMap fetch failed:', ocmResult.reason)
  if (outletResult.status === 'rejected') console.warn('Overpass fetch failed:', outletResult.reason)

  const nlrPoints = nlrResult.status === 'fulfilled' ? nlrResult.value : []
  const ocmPoints = ocmResult.status === 'fulfilled' ? ocmResult.value : []
  const outletPoints = outletResult.status === 'fulfilled' ? outletResult.value : []

  const evStations = dedupe(nlrPoints, ocmPoints)
  return [...evStations, ...outletPoints]
}

/**
 * Returns charge points within radiusMiles of center, restricted to source
 * types allowed by filter. Serves from cache if a fresh-enough result exists
 * for this bounding box; otherwise fetches from all sources in parallel,
 * merges, and re-caches. The filter is applied last, on top of a cache/fetch
 * that always covers every source — one cached result serves every filter mode.
 */
export async function chargePointsNear(
  center: LatLng,
  radiusMiles = 3.0,
  filter: ChargeStationFilter = 'BOTH',
): Promise<ChargePoint[]> {
  const { points: cached, isFresh } = await cache.getCached(center, radiusMiles)
  if (isFresh && cached.length > 0) {
    return cached.filter((p) => filterIncludes(filter, p.source))
  }

  const fresh = await fetchAndMerge(center, radiusMiles)
  if (fresh.length > 0) {
    await cache.upsertAll(fresh)
  }
  return fresh.filter((p) => filterIncludes(filter, p.source))
}

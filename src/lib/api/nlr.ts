import type { LatLng } from '../geo/geoMath'

const NLR_BASE_URL = 'https://developer.nlr.gov'
const NLR_API_KEY = import.meta.env.VITE_NLR_API_KEY as string

export interface NlrStation {
  id: number
  station_name: string
  latitude: number
  longitude: number
  ev_connector_types: string[] | null
  ev_network: string | null
}

interface NlrStationsResponse {
  fuel_stations: NlrStation[]
}

/** Same API that used to live at developer.nrel.gov — NREL was renamed the
 * National Laboratory of the Rockies (NLR) in Dec 2025, old domain retired
 * May 29, 2026. Same key format, same endpoints, new host. */
export async function getNearbyStations(center: LatLng, radiusMiles: number): Promise<NlrStation[]> {
  const url = new URL(`${NLR_BASE_URL}/api/alt-fuel-stations/v1.json`)
  url.searchParams.set('api_key', NLR_API_KEY)
  url.searchParams.set('latitude', String(center.lat))
  url.searchParams.set('longitude', String(center.lon))
  url.searchParams.set('radius', String(radiusMiles))
  url.searchParams.set('fuel_type', 'ELEC')
  url.searchParams.set('status', 'E') // currently available
  url.searchParams.set('access', 'public')

  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`NLR request failed (${response.status})`)

  const data: NlrStationsResponse = await response.json()
  return data.fuel_stations
}

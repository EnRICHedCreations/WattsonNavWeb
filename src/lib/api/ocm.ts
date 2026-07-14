import type { LatLng } from '../geo/geoMath'

const OCM_BASE_URL = 'https://api.openchargemap.io'

export interface OcmPoi {
  ID: number
  AddressInfo?: { Title?: string; Latitude: number; Longitude: number }
  Connections?: Array<{ ConnectionType?: { Title?: string } }>
  OperatorInfo?: { Title?: string }
}

export async function getNearby(center: LatLng, radiusMiles: number): Promise<OcmPoi[]> {
  const url = new URL(`${OCM_BASE_URL}/v3/poi/`)
  url.searchParams.set('latitude', String(center.lat))
  url.searchParams.set('longitude', String(center.lon))
  url.searchParams.set('distance', String(radiusMiles))
  url.searchParams.set('distanceunit', 'Miles')
  url.searchParams.set('maxresults', '50')
  url.searchParams.set('compact', 'true')
  url.searchParams.set('verbose', 'false')
  // Anonymous access — rate-limited but works. Add VITE_OCM_API_KEY later if needed.

  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`OpenChargeMap request failed (${response.status})`)
  return response.json()
}

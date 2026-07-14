import type { LatLng } from './geo/geoMath'

export interface RouteStep {
  instruction: string
  distanceMeters: number
  durationSeconds: number
  wayPointStart: number
  wayPointEnd: number
}

export interface RoutePolyline {
  points: LatLng[]
  distanceMeters: number
  durationSeconds: number
  steps: RouteStep[]
}

export type ChargeSource = 'NLR' | 'OPEN_CHARGE_MAP' | 'PUBLIC_OUTLET'

export type ChargeStationFilter = 'EV_ONLY' | 'PUBLIC_ONLY' | 'BOTH'

export function filterIncludes(filter: ChargeStationFilter, source: ChargeSource): boolean {
  switch (filter) {
    case 'EV_ONLY':
      return source === 'NLR' || source === 'OPEN_CHARGE_MAP'
    case 'PUBLIC_ONLY':
      return source === 'PUBLIC_OUTLET'
    case 'BOTH':
      return true
  }
}

export interface ChargePoint {
  id: string
  name: string
  location: LatLng
  source: ChargeSource
  connectorTypes: string[]
  networkName: string | null
}

export interface Pitstop {
  chargePoint: ChargePoint
  distanceFromStartMeters: number
}

export interface PitstopPlan {
  route: RoutePolyline
  pitstops: Pitstop[]
}

export interface GeocodeResult {
  label: string
  location: LatLng
}

export interface GroupSession {
  sessionId: string
  joinCode: string
  isLeader: boolean
}

export interface TeammatePosition {
  riderId: string
  displayName: string
  location: LatLng
  bearingDegrees: number | null
}

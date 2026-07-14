import { supabase } from '../supabase/client'
import type { LatLng } from '../geo/geoMath'
import type { ChargePoint, ChargeSource, GeocodeResult, GroupSession, PitstopPlan } from '../domain'

// --- Route JSON — must match RideRouteJson.kt field-for-field ---

interface RideStepJson {
  instruction: string
  distanceMeters: number
  durationSeconds: number
  wayPointStart: number
  wayPointEnd: number
}

interface RidePitstopJson {
  id: string
  name: string
  lat: number
  lon: number
  source: string
  connectorTypes: string[]
  networkName: string | null
  distanceFromStartMeters: number
}

interface RideRouteJson {
  points: number[][] // [lat, lon] pairs, matching Kotlin's ordering exactly
  distanceMeters: number
  durationSeconds: number
  steps: RideStepJson[]
  pitstops: RidePitstopJson[]
}

function planToRideRouteJson(plan: PitstopPlan): RideRouteJson {
  return {
    points: plan.route.points.map((p) => [p.lat, p.lon]),
    distanceMeters: plan.route.distanceMeters,
    durationSeconds: plan.route.durationSeconds,
    steps: plan.route.steps.map((s) => ({
      instruction: s.instruction,
      distanceMeters: s.distanceMeters,
      durationSeconds: s.durationSeconds,
      wayPointStart: s.wayPointStart,
      wayPointEnd: s.wayPointEnd,
    })),
    pitstops: plan.pitstops.map((p) => ({
      id: p.chargePoint.id,
      name: p.chargePoint.name,
      lat: p.chargePoint.location.lat,
      lon: p.chargePoint.location.lon,
      source: p.chargePoint.source,
      connectorTypes: p.chargePoint.connectorTypes,
      networkName: p.chargePoint.networkName,
      distanceFromStartMeters: p.distanceFromStartMeters,
    })),
  }
}

function rideRouteJsonToPlan(json: RideRouteJson): PitstopPlan {
  return {
    route: {
      points: json.points.map(([lat, lon]) => ({ lat, lon })),
      distanceMeters: json.distanceMeters,
      durationSeconds: json.durationSeconds,
      steps: json.steps.map((s) => ({
        instruction: s.instruction,
        distanceMeters: s.distanceMeters,
        durationSeconds: s.durationSeconds,
        wayPointStart: s.wayPointStart,
        wayPointEnd: s.wayPointEnd,
      })),
    },
    pitstops: json.pitstops.map((p) => ({
      chargePoint: {
        id: p.id,
        name: p.name,
        location: { lat: p.lat, lon: p.lon },
        source: p.source as ChargeSource,
        connectorTypes: p.connectorTypes,
        networkName: p.networkName,
      } as ChargePoint,
      distanceFromStartMeters: p.distanceFromStartMeters,
    })),
  }
}

// --- Session row (matches the shared ride_sessions table exactly) ---

interface RideSessionRow {
  id: string
  join_code: string
  leader_id: string
  origin_lat: number
  origin_lon: number
  destination_label: string
  dest_lat: number
  dest_lon: number
  charge_interval_miles: number
  route_json: string
  created_at: string
}

// Excludes ambiguous characters (0/O, 1/I), matches the Android app exactly —
// codes get read aloud/typed by hand between riders.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const JOIN_CODE_LENGTH = 6

function generateJoinCode(): string {
  let code = ''
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)]
  }
  return code
}

export async function createSession(
  leaderId: string,
  origin: LatLng,
  destination: GeocodeResult,
  chargeIntervalMiles: number,
  plan: PitstopPlan,
): Promise<GroupSession> {
  const joinCode = generateJoinCode()
  const routeJson = JSON.stringify(planToRideRouteJson(plan))

  const { data, error } = await supabase
    .from('ride_sessions')
    .insert({
      join_code: joinCode,
      leader_id: leaderId,
      origin_lat: origin.lat,
      origin_lon: origin.lon,
      destination_label: destination.label,
      dest_lat: destination.location.lat,
      dest_lon: destination.location.lon,
      charge_interval_miles: chargeIntervalMiles,
      route_json: routeJson,
    })
    .select()
    .single<RideSessionRow>()

  if (error || !data) {
    throw new Error(error?.message ?? "Supabase didn't return a session id")
  }

  return { sessionId: data.id, joinCode, isLeader: true }
}

/** Returns the session plus the exact plan the leader is navigating, so every
 * follower — Android or web — renders the identical route and pitstops. */
export async function joinSession(
  joinCode: string,
): Promise<{ session: GroupSession; plan: PitstopPlan } | null> {
  const { data, error } = await supabase
    .from('ride_sessions')
    .select('*')
    .eq('join_code', joinCode.toUpperCase())
    .limit(1)
    .maybeSingle<RideSessionRow>()

  if (error || !data) return null

  const routeJson: RideRouteJson = JSON.parse(data.route_json)
  const plan = rideRouteJsonToPlan(routeJson)

  return {
    session: { sessionId: data.id, joinCode: data.join_code, isLeader: false },
    plan,
  }
}

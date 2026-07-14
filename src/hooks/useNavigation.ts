import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useStore } from './useStore'
import { useGeolocation } from './useGeolocation'
import {
  cumulativeDistances,
  distanceMeters,
  nearestPointIndex,
  type LatLng,
} from '../lib/geo/geoMath'
import type {
  ChargePoint,
  ChargeStationFilter,
  GeocodeResult,
  GroupSession,
  PitstopPlan,
  TeammatePosition,
} from '../lib/domain'
import { geocodeSearch } from '../lib/api/ors'
import { plan as planRouteInternal } from '../lib/pitstopPlanner'
import * as preferences from '../lib/db/preferences'
import * as tripHistory from '../lib/db/tripHistory'
import type { TripHistoryEntry } from '../lib/db/tripHistory'
import * as riderIdentity from '../lib/db/riderIdentity'
import * as groupRideRepository from '../lib/repository/groupRideRepository'
import { supabase } from '../lib/supabase/client'

/** Wire format must match RiderPresence.kt's @SerialName annotations exactly:
 * rider_id/display_name are explicitly renamed to snake_case in Kotlin's
 * kotlinx.serialization, while lat/lon/bearing are single words and stay
 * as-is on both sides. Using camelCase here (the original bug) meant an
 * Android-sourced presence payload's rider_id/display_name never matched
 * this shape at all — every field access came back undefined, breaking
 * cross-platform identification even though lat/lon happened to still work. */
interface RiderPresencePayload {
  rider_id: string
  display_name: string
  lat: number
  lon: number
  bearing: number | null
}

interface WaitForMeEvent {
  rider_id: string
  display_name: string
}

const SEARCH_DEBOUNCE_MS = 400
const OFF_ROUTE_THRESHOLD_METERS = 40
const REROUTE_COOLDOWN_MS = 15_000
const DESTINATION_ARRIVAL_THRESHOLD_METERS = 30
const PITSTOP_ARRIVAL_THRESHOLD_METERS = 40

export interface NavState {
  origin: LatLng | null
  liveLocation: LatLng | null
  puckBearingDegrees: number | null

  originQuery: string
  originGeocodeResults: GeocodeResult[]
  selectedOrigin: GeocodeResult | null

  destinationQuery: string
  geocodeResults: GeocodeResult[]
  selectedDestination: GeocodeResult | null

  chargeIntervalMiles: number
  chargeStationFilter: ChargeStationFilter

  pitstopPlan: PitstopPlan | null
  isPlanning: boolean
  errorMessage: string | null

  isNavigating: boolean
  currentStepIndex: number
  isRerouting: boolean
  selectedPitstop: ChargePoint | null
  nextPitstopName: string | null
  distanceToNextPitstopMeters: number | null
  arrivalMessage: string | null
  recentTrips: TripHistoryEntry[]

  riderId: string
  displayName: string
  groupSession: GroupSession | null
  teammatePositions: TeammatePosition[]
  waitForMeMessage: string | null
  isJoiningGroup: boolean
  groupError: string | null
}

const initialState: NavState = {
  origin: null,
  liveLocation: null,
  puckBearingDegrees: null,
  originQuery: '',
  originGeocodeResults: [],
  selectedOrigin: null,
  destinationQuery: '',
  geocodeResults: [],
  selectedDestination: null,
  chargeIntervalMiles: 20,
  chargeStationFilter: 'BOTH',
  pitstopPlan: null,
  isPlanning: false,
  errorMessage: null,
  isNavigating: false,
  currentStepIndex: 0,
  isRerouting: false,
  selectedPitstop: null,
  nextPitstopName: null,
  distanceToNextPitstopMeters: null,
  arrivalMessage: null,
  recentTrips: [],
  riderId: '',
  displayName: 'Rider',
  groupSession: null,
  teammatePositions: [],
  waitForMeMessage: null,
  isJoiningGroup: false,
  groupError: null,
}

export function useNavigation() {
  const { stateRef, setState } = useStore<NavState>(initialState)
  const { fix, error: geoError } = useGeolocation()

  // Plain bookkeeping refs — same reasoning as the Kotlin app's private vars
  // outside NavUiState: internal control flow, never meant to be observable UI state.
  const cumulativeDistancesRef = useRef<number[]>([])
  const visitedPitstopIdsRef = useRef<Set<string>>(new Set())
  const announcedPitstopIdsRef = useRef<Set<string>>(new Set())
  const lastRerouteAtRef = useRef(0)
  const hasArrivedRef = useRef(false)
  const previousFixLocationRef = useRef<LatLng | null>(null)
  const originSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const destinationSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  // Load persisted settings + trip history + rider identity once on mount.
  useEffect(() => {
    void (async () => {
      const [savedInterval, savedFilter, trips, riderId, displayName] = await Promise.all([
        preferences.getChargeIntervalMiles(initialState.chargeIntervalMiles),
        preferences.getChargeStationFilter(initialState.chargeStationFilter),
        tripHistory.getRecentTrips(),
        riderIdentity.getRiderId(),
        riderIdentity.getDisplayName(),
      ])
      setState({
        chargeIntervalMiles: savedInterval,
        chargeStationFilter: savedFilter,
        recentTrips: trips,
        riderId,
        displayName,
      })
    })()
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Search ---

  function onOriginQueryChanged(query: string) {
    setState({ originQuery: query, selectedOrigin: null })
    if (originSearchTimer.current) clearTimeout(originSearchTimer.current)
    if (query.trim().length < 3) {
      setState({ originGeocodeResults: [] })
      return
    }
    originSearchTimer.current = setTimeout(async () => {
      const results = await geocodeSearch(query)
      setState({ originGeocodeResults: results })
    }, SEARCH_DEBOUNCE_MS)
  }

  function selectOrigin(result: GeocodeResult) {
    setState({ selectedOrigin: result, originQuery: result.label, originGeocodeResults: [] })
  }

  function clearOrigin() {
    if (originSearchTimer.current) clearTimeout(originSearchTimer.current)
    setState({ selectedOrigin: null, originQuery: '', originGeocodeResults: [] })
  }

  function onDestinationQueryChanged(query: string) {
    setState({ destinationQuery: query, selectedDestination: null })
    if (destinationSearchTimer.current) clearTimeout(destinationSearchTimer.current)
    if (query.trim().length < 3) {
      setState({ geocodeResults: [] })
      return
    }
    destinationSearchTimer.current = setTimeout(async () => {
      const results = await geocodeSearch(query)
      setState({ geocodeResults: results })
    }, SEARCH_DEBOUNCE_MS)
  }

  function selectDestination(result: GeocodeResult) {
    setState({ selectedDestination: result, destinationQuery: result.label, geocodeResults: [] })
  }

  function onChargeIntervalChanged(miles: number) {
    setState({ chargeIntervalMiles: miles })
    void preferences.setChargeIntervalMiles(miles)
  }

  function onChargeStationFilterChanged(filter: ChargeStationFilter) {
    setState({ chargeStationFilter: filter })
    void preferences.setChargeStationFilter(filter)
  }

  function selectHistoryEntry(entry: TripHistoryEntry) {
    setState({
      selectedDestination: entry.destination,
      destinationQuery: entry.destination.label,
      chargeIntervalMiles: entry.chargeIntervalMiles,
      geocodeResults: [],
    })
  }

  async function refreshTripHistory() {
    const trips = await tripHistory.getRecentTrips()
    setState({ recentTrips: trips })
  }

  function onPitstopTapped(point: ChargePoint) {
    setState({ selectedPitstop: point })
  }

  function clearSelectedPitstop() {
    setState({ selectedPitstop: null })
  }

  function clearArrivalMessage() {
    setState({ arrivalMessage: null })
  }

  // --- Planning ---

  async function planRoute() {
    const current = stateRef.current
    const effectiveOrigin = current.selectedOrigin?.location ?? current.origin
    if (!effectiveOrigin) {
      setState({ errorMessage: 'Waiting on your current location — check location permission, or set a starting point.' })
      return
    }
    if (!current.selectedDestination) {
      setState({ errorMessage: 'Pick a destination first.' })
      return
    }

    setState({ isPlanning: true, errorMessage: null })
    try {
      const result = await planRouteInternal({
        origin: effectiveOrigin,
        destination: current.selectedDestination.location,
        chargeIntervalMiles: current.chargeIntervalMiles,
        stationFilter: current.chargeStationFilter,
      })
      visitedPitstopIdsRef.current = new Set()
      announcedPitstopIdsRef.current = new Set()
      cumulativeDistancesRef.current = cumulativeDistances(result.route.points)
      setState({ pitstopPlan: result, isPlanning: false, currentStepIndex: 0 })
    } catch (error) {
      setState({ isPlanning: false, errorMessage: error instanceof Error ? error.message : "Couldn't plan a route" })
    }
  }

  // --- Navigation lifecycle ---

  function startNavigation() {
    const current = stateRef.current
    if (!current.pitstopPlan) {
      setState({ errorMessage: 'Plan a route before starting navigation.' })
      return
    }
    cumulativeDistancesRef.current = cumulativeDistances(current.pitstopPlan.route.points)
    visitedPitstopIdsRef.current = new Set()
    announcedPitstopIdsRef.current = new Set()
    previousFixLocationRef.current = null
    hasArrivedRef.current = false
    setState({ isNavigating: true, currentStepIndex: 0, arrivalMessage: null })

    const effectiveOrigin = current.selectedOrigin?.location ?? current.origin
    if (effectiveOrigin && current.selectedDestination) {
      void tripHistory
        .saveTrip({
          origin: effectiveOrigin,
          destination: current.selectedDestination,
          chargeIntervalMiles: current.chargeIntervalMiles,
          totalDistanceMeters: current.pitstopPlan.route.distanceMeters,
        })
        .then(refreshTripHistory)
    }
  }

  function stopNavigation() {
    previousFixLocationRef.current = null
    setState({ isNavigating: false })
  }

  // --- Group rides ---

  function setDisplayName(name: string) {
    setState({ displayName: name })
    void riderIdentity.setDisplayName(name)
  }

  /** Registers presence/broadcast listeners BEFORE subscribing — supabase-js's
   * idiomatic .on().on().subscribe() chaining pattern means this ordering,
   * which had to be fixed after the fact on the Android side, is just how the
   * library is meant to be used here. `sync` reads the full reconciled
   * presence state via presenceState() rather than manually replaying
   * join/leave diffs — sidesteps the flicker issue the Android app hit,
   * rather than needing an append-only workaround after seeing it happen. */
  function connectChannel(session: GroupSession) {
    const channel = supabase.channel(`ride:${session.sessionId}`, {
      config: { private: true },
    })

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<RiderPresencePayload>()
      const selfRiderId = stateRef.current.riderId
      const positions: TeammatePosition[] = Object.values(state)
        .flat()
        .filter((p) => p.rider_id !== selfRiderId)
        // Defensive: a marker constructed with non-finite coordinates is what
        // produces MapLibre's "reading 'lng'" crash (Marker._update() reading
        // an undefined/NaN-derived _lngLat). Whatever the upstream cause,
        // never let a malformed entry reach the map layer.
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .map((p) => ({
          riderId: p.rider_id,
          displayName: p.display_name,
          location: { lat: p.lat, lon: p.lon },
          bearingDegrees: p.bearing,
        }))
      setState({ teammatePositions: positions })
    })

    channel.on('broadcast', { event: 'wait_for_me' }, ({ payload }) => {
      const event = payload as WaitForMeEvent
      if (event.rider_id !== stateRef.current.riderId) {
        setState({ waitForMeMessage: `${event.display_name} says: wait up!` })
      }
    })

    channel.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Group ride channel error:', status, err)
      }
    })

    channelRef.current = channel
  }

  /** Leader flow — requires an already-planned route, since the whole point
   * of a group session is that every rider navigates the exact same plan. */
  async function startGroupRide() {
    const current = stateRef.current
    const plan = current.pitstopPlan
    const origin = current.selectedOrigin?.location ?? current.origin
    const destination = current.selectedDestination
    if (!plan || !origin || !destination) {
      setState({ groupError: 'Plan a route before starting a group ride.' })
      return
    }

    setState({ isJoiningGroup: true, groupError: null })
    try {
      const session = await groupRideRepository.createSession(
        current.riderId,
        origin,
        destination,
        current.chargeIntervalMiles,
        plan,
      )
      setState({ groupSession: session, isJoiningGroup: false })
      connectChannel(session)
      startNavigation()
    } catch (error) {
      setState({
        isJoiningGroup: false,
        groupError: error instanceof Error ? error.message : "Couldn't start the group ride",
      })
    }
  }

  /** Follower flow — pulls down the leader's exact plan (Android or web) and
   * adopts it as this device's own pitstopPlan. */
  async function joinGroupRide(joinCode: string) {
    setState({ isJoiningGroup: true, groupError: null })
    try {
      const result = await groupRideRepository.joinSession(joinCode)
      if (!result) {
        setState({ isJoiningGroup: false, groupError: 'No ride found for that code.' })
        return
      }
      cumulativeDistancesRef.current = cumulativeDistances(result.plan.route.points)
      visitedPitstopIdsRef.current = new Set()
      announcedPitstopIdsRef.current = new Set()
      setState({
        groupSession: result.session,
        pitstopPlan: result.plan,
        currentStepIndex: 0,
        isJoiningGroup: false,
      })
      connectChannel(result.session)
      startNavigation()
    } catch (error) {
      setState({
        isJoiningGroup: false,
        groupError: error instanceof Error ? error.message : "Couldn't join that ride",
      })
    }
  }

  async function leaveGroupRide() {
    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    setState({ groupSession: null, teammatePositions: [], waitForMeMessage: null })
  }

  async function sendWaitForMe() {
    const current = stateRef.current
    if (!channelRef.current || !current.groupSession) return
    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'wait_for_me',
        payload: { rider_id: current.riderId, display_name: current.displayName } satisfies WaitForMeEvent,
      })
    } catch (error) {
      console.error('sendWaitForMe failed:', error)
      setState({ groupError: 'Wait-for-me failed to send.' })
    }
  }

  function clearWaitForMeMessage() {
    setState({ waitForMeMessage: null })
  }

  // --- Location-driven logic: bearing resolution already lives in
  // useGeolocation; this effect handles everything that depends on
  // *navigation* state (step tracking, off-route reroute, arrival). ---

  useEffect(() => {
    if (!fix) return

    setState((prev) => (prev.origin ? {} : { origin: fix.location }))
    setState({ liveLocation: fix.location, puckBearingDegrees: fix.bearingDegrees })
    previousFixLocationRef.current = fix.location

    const current = stateRef.current

    if (current.groupSession && channelRef.current) {
      const payload: RiderPresencePayload = {
        rider_id: current.riderId,
        display_name: current.displayName,
        lat: fix.location.lat,
        lon: fix.location.lon,
        bearing: fix.bearingDegrees,
      }
      channelRef.current.track(payload).catch((error) => {
        console.error('trackPosition failed:', error)
      })
    }

    if (!current.isNavigating) return

    const destination = current.selectedDestination
    if (destination && !hasArrivedRef.current) {
      const distanceToDestination = distanceMeters(fix.location, destination.location)
      if (distanceToDestination <= DESTINATION_ARRIVAL_THRESHOLD_METERS) {
        hasArrivedRef.current = true
        setState({ arrivalMessage: `You've arrived at ${destination.label}` })
        stopNavigation()
        return
      }
    }

    const plan = current.pitstopPlan
    if (!plan) return
    const points = plan.route.points
    if (points.length === 0 || cumulativeDistancesRef.current.length !== points.length) return

    const nearestIndex = nearestPointIndex(fix.location, points)
    const distanceFromRoute = distanceMeters(fix.location, points[nearestIndex])
    const distanceAlongRoute = cumulativeDistancesRef.current[nearestIndex]

    advanceCurrentStep(nearestIndex, plan)
    markPassedPitstops(distanceAlongRoute, plan)
    checkPitstopArrival(fix.location, plan)
    updateNextPitstopDistance(distanceAlongRoute, plan)

    if (distanceFromRoute > OFF_ROUTE_THRESHOLD_METERS) {
      void maybeReroute(fix.location)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix])

  function advanceCurrentStep(nearestIndex: number, plan: PitstopPlan) {
    const steps = plan.route.steps
    if (steps.length === 0) return
    const matchingIndex = steps.findIndex((s) => nearestIndex >= s.wayPointStart && nearestIndex <= s.wayPointEnd)
    if (matchingIndex === -1) return
    setState((prev) => (matchingIndex >= prev.currentStepIndex ? { currentStepIndex: matchingIndex } : {}))
  }

  function markPassedPitstops(distanceAlongRoute: number, plan: PitstopPlan) {
    for (const pitstop of plan.pitstops) {
      if (pitstop.distanceFromStartMeters <= distanceAlongRoute) {
        visitedPitstopIdsRef.current.add(pitstop.chargePoint.id)
      }
    }
  }

  /** Physical-proximity arrival check, distinct from the route-position
   * "visited" tracking above — announces once per pitstop. */
  function checkPitstopArrival(location: LatLng, plan: PitstopPlan) {
    for (const pitstop of plan.pitstops) {
      if (announcedPitstopIdsRef.current.has(pitstop.chargePoint.id)) continue
      const distance = distanceMeters(location, pitstop.chargePoint.location)
      if (distance <= PITSTOP_ARRIVAL_THRESHOLD_METERS) {
        announcedPitstopIdsRef.current.add(pitstop.chargePoint.id)
        setState({ arrivalMessage: `Arrived at ${pitstop.chargePoint.name}` })
      }
    }
  }

  function updateNextPitstopDistance(distanceAlongRoute: number, plan: PitstopPlan) {
    if (plan.pitstops.length === 0) {
      setState({ nextPitstopName: null, distanceToNextPitstopMeters: null })
      return
    }
    const next = plan.pitstops.find((p) => p.distanceFromStartMeters > distanceAlongRoute)
    setState({
      nextPitstopName: next?.chargePoint.name ?? null,
      distanceToNextPitstopMeters: next ? next.distanceFromStartMeters - distanceAlongRoute : null,
    })
  }

  async function maybeReroute(currentLocation: LatLng) {
    const now = Date.now()
    if (now - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return
    const current = stateRef.current
    const destination = current.selectedDestination
    if (!destination) return

    lastRerouteAtRef.current = now
    setState({ isRerouting: true })
    try {
      const newPlan = await planRouteInternal({
        origin: currentLocation,
        destination: destination.location,
        chargeIntervalMiles: current.chargeIntervalMiles,
        excludeChargePointIds: new Set(visitedPitstopIdsRef.current),
        stationFilter: current.chargeStationFilter,
      })
      cumulativeDistancesRef.current = cumulativeDistances(newPlan.route.points)
      setState({ pitstopPlan: newPlan, currentStepIndex: 0, isRerouting: false })
    } catch {
      setState({ isRerouting: false })
    }
  }

  return {
    state: stateRef.current,
    geoError,
    onOriginQueryChanged,
    selectOrigin,
    clearOrigin,
    onDestinationQueryChanged,
    selectDestination,
    onChargeIntervalChanged,
    onChargeStationFilterChanged,
    selectHistoryEntry,
    onPitstopTapped,
    clearSelectedPitstop,
    clearArrivalMessage,
    planRoute,
    startNavigation,
    stopNavigation,
    setDisplayName,
    startGroupRide,
    joinGroupRide,
    leaveGroupRide,
    sendWaitForMe,
    clearWaitForMeMessage,
  }
}

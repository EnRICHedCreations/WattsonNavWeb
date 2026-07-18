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
import * as chargePointRepository from '../lib/repository/chargePointRepository'
import { WhPerMileCalculator } from '../lib/domain/whPerMileCalculator'
import type { WheelTelemetry } from '../lib/wheel/gotwayFrameParser'
import { WheelBleClient, type WheelConnectionState } from '../lib/wheel/wheelBleClient'

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
const DIRECTION_CHANGE_DEBOUNCE_METERS = 60
const LOW_BATTERY_SNOOZE_MILLIS = 10 * 60 * 1000 // 10 minutes

const COMPASS_SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function bearingToCompassSector(bearingDegrees: number): string {
  const normalized = ((bearingDegrees % 360) + 360) % 360
  const index = Math.floor((normalized + 22.5) / 45) % 8
  return COMPASS_SECTORS[index]
}

function compassSectorSpokenLabel(sector: string): string {
  switch (sector) {
    case 'N':
      return 'north'
    case 'NE':
      return 'northeast'
    case 'E':
      return 'east'
    case 'SE':
      return 'southeast'
    case 'S':
      return 'south'
    case 'SW':
      return 'southwest'
    case 'W':
      return 'west'
    case 'NW':
      return 'northwest'
    default:
      return sector
  }
}
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

  // Wheel connection (experimental). Chrome only — no iOS Safari support at
  // all, a platform limitation, not something fixable here. See
  // WheelBleClient's own doc comment for the rest of the caveats.
  wheelConnectionState: WheelConnectionState
  wheelTelemetry: WheelTelemetry | null
  wheelWhPerMile: number | null

  // Exploration Mode — no-destination riding.
  isExploring: boolean
  explorationDistanceMeters: number
  explorationDirectionMessage: string | null
  explorationVoltageThresholdInput: string
  explorationAutoRedirectVoltage: number | null
  explorationLowBatteryAlertMessage: string | null

  // Add Charge — address search + EV/Public. No separate name field; the
  // address label doubles as the spot's name, matching the Android design.
  showSubmitChargePointForm: boolean
  submitChargePointAddressQuery: string
  submitChargePointAddressResults: GeocodeResult[]
  submitChargePointSelectedAddress: GeocodeResult | null
  submitChargePointCategory: 'EV' | 'PUBLIC'
  isSubmittingChargePoint: boolean

  // View submitted spots — browse + flag.
  showViewSubmittedSpots: boolean
  isFetchingSubmittedSpots: boolean
  submittedSpotsOptions: ChargePoint[]
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
  wheelConnectionState: 'DISCONNECTED',
  wheelTelemetry: null,
  wheelWhPerMile: null,
  isExploring: false,
  explorationDistanceMeters: 0,
  explorationDirectionMessage: null,
  explorationVoltageThresholdInput: '',
  explorationAutoRedirectVoltage: null,
  explorationLowBatteryAlertMessage: null,
  showSubmitChargePointForm: false,
  submitChargePointAddressQuery: '',
  submitChargePointAddressResults: [],
  submitChargePointSelectedAddress: null,
  submitChargePointCategory: 'EV',
  isSubmittingChargePoint: false,
  showViewSubmittedSpots: false,
  isFetchingSubmittedSpots: false,
  submittedSpotsOptions: [],
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

  const wheelClientRef = useRef<WheelBleClient | null>(null)
  const whPerMileCalculatorRef = useRef(new WhPerMileCalculator())
  const wheelTripDistanceMetersRef = useRef(0)
  const previousWheelFixLocationRef = useRef<LatLng | null>(null)

  const previousExplorationFixLocationRef = useRef<LatLng | null>(null)
  const announcedDirectionSectorRef = useRef<string | null>(null)
  const candidateDirectionSectorRef = useRef<string | null>(null)
  const candidateDirectionSectorStartLocationRef = useRef<LatLng | null>(null)
  const lowBatteryAlertSnoozedUntilRef = useRef(0)

  const submitChargePointSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    // Typing a query alone never sets selectedOrigin/selectedDestination —
    // only tapping a suggestion does. If the rider typed something and
    // clicked straight to Plan route without confirming it, don't silently
    // drop what they typed and fall back to current location: resolve it now.
    let originResult = current.selectedOrigin
    if (!originResult && current.originQuery.trim().length >= 3) {
      setState({ isPlanning: true })
      const results = current.originGeocodeResults.length > 0
        ? current.originGeocodeResults
        : await geocodeSearch(current.originQuery)
      if (results.length > 0) {
        originResult = results[0]
        setState({ selectedOrigin: originResult, originQuery: originResult.label, originGeocodeResults: [] })
      }
    }

    let destinationResult = current.selectedDestination
    if (!destinationResult && current.destinationQuery.trim().length >= 3) {
      const results = current.geocodeResults.length > 0
        ? current.geocodeResults
        : await geocodeSearch(current.destinationQuery)
      if (results.length > 0) {
        destinationResult = results[0]
        setState({ selectedDestination: destinationResult, destinationQuery: destinationResult.label, geocodeResults: [] })
      }
    }

    const effectiveOrigin = originResult?.location ?? current.origin
    if (!effectiveOrigin) {
      setState({ isPlanning: false, errorMessage: 'Waiting on your current location — check location permission, or set a starting point.' })
      return
    }
    if (!destinationResult) {
      setState({ isPlanning: false, errorMessage: 'Pick a destination first.' })
      return
    }

    setState({ isPlanning: true, errorMessage: null })
    try {
      const result = await planRouteInternal({
        origin: effectiveOrigin,
        destination: destinationResult.location,
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
    const topic = `ride:${session.sessionId}`
    console.log('connectChannel: connecting to', topic)
    const channel = supabase.channel(topic, {
      config: { private: true },
    })

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<RiderPresencePayload>()
      const selfRiderId = stateRef.current.riderId
      // Log the RAW state before any filtering — this is the single most
      // useful piece of evidence for cross-platform issues: it shows exactly
      // what field names and values arrived on the wire, from either platform.
      console.log('presence sync — raw state:', JSON.stringify(state), 'selfRiderId:', selfRiderId)

      const allEntries = Object.values(state).flat()
      const afterSelfFilter = allEntries.filter((p) => p.rider_id !== selfRiderId)
      const afterCoordFilter = afterSelfFilter.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))

      if (afterSelfFilter.length !== afterCoordFilter.length) {
        console.warn(
          'presence sync — dropped entries with non-finite coordinates:',
          afterSelfFilter.filter((p) => !(Number.isFinite(p.lat) && Number.isFinite(p.lon))),
        )
      }

      const positions: TeammatePosition[] = afterCoordFilter.map((p) => ({
        riderId: p.rider_id,
        displayName: p.display_name,
        location: { lat: p.lat, lon: p.lon },
        bearingDegrees: p.bearing,
      }))
      console.log('presence sync — resolved teammates:', positions.length, positions)
      setState({ teammatePositions: positions })
    })

    channel.on('broadcast', { event: 'wait_for_me' }, ({ payload }) => {
      console.log('wait_for_me broadcast received — raw payload:', JSON.stringify(payload))
      const event = payload as WaitForMeEvent
      if (event.rider_id !== stateRef.current.riderId) {
        setState({ waitForMeMessage: `${event.display_name} says: wait up!` })
      }
    })

    channel.subscribe((status, err) => {
      console.log('channel subscribe status:', status, err ?? '')
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Group ride channel error:', status, err)
      }
    })

    channelRef.current = channel
  }

  /** Leader flow — requires an already-planned route, since the whole point
   * of a group session is that every rider navigates the exact same plan. */
  async function startGroupRide() {
    console.log('startGroupRide called')
    const current = stateRef.current
    const plan = current.pitstopPlan
    const origin = current.selectedOrigin?.location ?? current.origin
    const destination = current.selectedDestination
    if (!plan || !origin || !destination) {
      setState({ groupError: 'Plan a route before starting a group ride.' })
      return
    }

    // Clear the custom starting point now that we've captured it above — a
    // group ride is inherently live (this is about to be shared with other
    // riders), so it shouldn't stay in preview mode for the leader either.
    setState({ selectedOrigin: null, originQuery: '', originGeocodeResults: [] })

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
    console.log('joinGroupRide called with code:', JSON.stringify(joinCode), 'current isJoiningGroup:', stateRef.current.isJoiningGroup)
    setState({ isJoiningGroup: true, groupError: null, selectedOrigin: null, originQuery: '', originGeocodeResults: [] })
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
      channelRef.current
        .track(payload)
        .then(() => console.log('trackPosition sent:', JSON.stringify(payload)))
        .catch((error) => console.error('trackPosition failed:', error))
    }

    trackWheelTelemetry(fix.location)

    if (current.isExploring) {
      handleExplorationUpdate(fix.location, fix.bearingDegrees)
      return
    }

    if (!current.isNavigating) return

    // A custom starting point means the rider isn't physically where the
    // route begins — treat this as a preview, not live navigation. Without
    // this, off-route detection fires almost immediately (the rider's real
    // GPS position is far from the route's start) and silently discards
    // the chosen starting point by rerouting from wherever they actually
    // are, which is exactly the bug being fixed here. Same distinction
    // Google Maps makes between previewing directions and actively
    // navigating them.
    if (current.selectedOrigin) return

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

  // --- Wheel connection (experimental) ---

  function connectWheel() {
    if (!WheelBleClient.isSupported()) {
      setState({ errorMessage: 'Web Bluetooth is not available in this browser (Chrome only, no iOS Safari).' })
      return
    }
    wheelTripDistanceMetersRef.current = 0
    previousWheelFixLocationRef.current = null
    whPerMileCalculatorRef.current.reset()
    setState({ wheelWhPerMile: null })

    const client = new WheelBleClient({ cellCount: 16 })
    wheelClientRef.current = client
    client.onStateChange((wheelConnectionState) => setState({ wheelConnectionState }))
    client.onTelemetry((wheelTelemetry) => {
      setState({ wheelTelemetry })
      checkLowBatteryAutoRedirect(wheelTelemetry)
    })
    client.connect().catch((error: unknown) => {
      console.error('connectWheel failed:', error)
      setState({ errorMessage: error instanceof Error ? error.message : 'Could not connect to wheel' })
    })
  }

  function disconnectWheel() {
    wheelClientRef.current?.disconnect()
  }

  /** Shared between route navigation and Exploration Mode's location
   * handling below — Wh/mile tracking works the same regardless of whether
   * there's a planned route underneath it. */
  function trackWheelTelemetry(fixLocation: LatLng) {
    if (stateRef.current.wheelConnectionState !== 'CONNECTED') return
    const previous = previousWheelFixLocationRef.current
    if (previous) {
      wheelTripDistanceMetersRef.current += distanceMeters(previous, fixLocation)
    }
    previousWheelFixLocationRef.current = fixLocation

    const telemetry = stateRef.current.wheelTelemetry
    if (!telemetry || telemetry.voltageVolts == null || telemetry.currentAmps == null) return
    const powerWatts = telemetry.voltageVolts * telemetry.currentAmps
    const whPerMile = whPerMileCalculatorRef.current.addSample(
      Date.now(),
      wheelTripDistanceMetersRef.current,
      powerWatts,
    )
    if (whPerMile != null) {
      setState({ wheelWhPerMile: whPerMile })
    }
  }

  // --- Exploration Mode ---
  // No destination, no planned route — tracks the ride and announces
  // significant direction changes. Mutually exclusive with route
  // navigation, same as the Android app.

  function onExplorationVoltageThresholdChanged(value: string) {
    setState({ explorationVoltageThresholdInput: value })
  }

  function startExploring() {
    const current = stateRef.current
    if (current.isExploring || current.isNavigating) return

    previousExplorationFixLocationRef.current = null
    announcedDirectionSectorRef.current = null
    candidateDirectionSectorRef.current = null
    candidateDirectionSectorStartLocationRef.current = null
    wheelTripDistanceMetersRef.current = 0
    previousWheelFixLocationRef.current = null
    whPerMileCalculatorRef.current.reset()
    lowBatteryAlertSnoozedUntilRef.current = 0

    const parsedThreshold = parseFloat(current.explorationVoltageThresholdInput)
    const thresholdVoltage = !isNaN(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : null

    setState({
      isExploring: true,
      explorationDistanceMeters: 0,
      explorationDirectionMessage: null,
      explorationAutoRedirectVoltage: thresholdVoltage,
      explorationLowBatteryAlertMessage: null,
      wheelWhPerMile: null,
    })
  }

  function stopExploring() {
    previousExplorationFixLocationRef.current = null
    setState({ isExploring: false })
  }

  function handleExplorationUpdate(fixLocation: LatLng, bearingDegrees: number | null) {
    const previous = previousExplorationFixLocationRef.current
    if (previous) {
      const delta = distanceMeters(previous, fixLocation)
      setState((prev) => ({ explorationDistanceMeters: prev.explorationDistanceMeters + delta }))
    }
    previousExplorationFixLocationRef.current = fixLocation

    if (bearingDegrees != null) {
      maybeAnnounceDirectionChange(bearingDegrees, fixLocation)
    }
  }

  /** 8-point compass, debounced by distance rather than reacting to every
   * GPS sample — raw bearing is noisy enough that a normal street curve
   * would otherwise trigger a spurious "now heading X" announcement. */
  function maybeAnnounceDirectionChange(bearingDegrees: number, currentLocation: LatLng) {
    const sector = bearingToCompassSector(bearingDegrees)

    if (sector === announcedDirectionSectorRef.current) {
      candidateDirectionSectorRef.current = null
      candidateDirectionSectorStartLocationRef.current = null
      return
    }

    if (sector !== candidateDirectionSectorRef.current) {
      candidateDirectionSectorRef.current = sector
      candidateDirectionSectorStartLocationRef.current = currentLocation
      return
    }

    const startLocation = candidateDirectionSectorStartLocationRef.current
    if (!startLocation) return
    const distanceInCandidate = distanceMeters(startLocation, currentLocation)
    if (distanceInCandidate < DIRECTION_CHANGE_DEBOUNCE_METERS) return

    announcedDirectionSectorRef.current = sector
    candidateDirectionSectorRef.current = null
    candidateDirectionSectorStartLocationRef.current = null

    setState({ explorationDirectionMessage: `Heading ${compassSectorSpokenLabel(sector)}` })
  }

  /** Alert-with-easy-dismiss, not a hard automatic switch. Snoozes for a
   * while on dismiss rather than for the rest of the ride. Compares
   * against raw voltage directly — no estimated-percentage step to be
   * wrong about, matching the Android app's own later correction. */
  function checkLowBatteryAutoRedirect(telemetry: WheelTelemetry) {
    const current = stateRef.current
    if (!current.isExploring) return
    const thresholdVoltage = current.explorationAutoRedirectVoltage
    if (thresholdVoltage == null) return
    if (current.explorationLowBatteryAlertMessage != null) return
    if (Date.now() < lowBatteryAlertSnoozedUntilRef.current) return
    const voltage = telemetry.voltageVolts
    if (voltage == null) return

    if (voltage <= thresholdVoltage) {
      setState({
        explorationLowBatteryAlertMessage: `Battery at ${voltage.toFixed(1)}V — route to the nearest charging station?`,
      })
    }
  }

  function acceptLowBatteryRedirect() {
    setState({ explorationLowBatteryAlertMessage: null })
    void routeToNearestChargeStation()
  }

  function dismissLowBatteryAlert() {
    lowBatteryAlertSnoozedUntilRef.current = Date.now() + LOW_BATTERY_SNOOZE_MILLIS
    setState({ explorationLowBatteryAlertMessage: null })
  }

  // --- Charging ---

  async function findNearestChargeStation(location: LatLng, filter: ChargeStationFilter) {
    for (const radiusMiles of [1, 3, 8, 20]) {
      const candidates = await chargePointRepository.chargePointsNear(location, radiusMiles, filter)
      if (candidates.length === 0) continue
      return candidates.reduce((closest, candidate) =>
        distanceMeters(location, candidate.location) < distanceMeters(location, closest.location)
          ? candidate
          : closest,
      )
    }
    return null
  }

  async function routeToNearestChargeStation() {
    const current = stateRef.current
    const currentLocation = current.liveLocation ?? current.origin
    if (!currentLocation) {
      setState({ errorMessage: 'Waiting on your current location.' })
      return
    }

    if (current.isExploring) stopExploring()

    setState({
      isPlanning: true,
      errorMessage: null,
      selectedOrigin: null,
      originQuery: '',
      originGeocodeResults: [],
    })

    let nearest = await findNearestChargeStation(currentLocation, current.chargeStationFilter)
    if (!nearest && current.chargeStationFilter !== 'BOTH') {
      // A configured PUBLIC_ONLY filter shouldn't make this report nothing
      // found when EV stations are actually available nearby.
      nearest = await findNearestChargeStation(currentLocation, 'BOTH')
    }
    if (!nearest) {
      setState({ isPlanning: false, errorMessage: 'No charge stations found nearby.' })
      return
    }

    const destination: GeocodeResult = { label: nearest.name, location: nearest.location }
    setState({ selectedDestination: destination, destinationQuery: destination.label, geocodeResults: [] })

    setState({ isPlanning: true, errorMessage: null })
    try {
      const newPlan = await planRouteInternal({
        origin: currentLocation,
        destination: destination.location,
        chargeIntervalMiles: current.chargeIntervalMiles,
        stationFilter: current.chargeStationFilter,
      })
      cumulativeDistancesRef.current = cumulativeDistances(newPlan.route.points)
      setState({ pitstopPlan: newPlan, isPlanning: false, currentStepIndex: 0 })
      startNavigation()
    } catch (error) {
      setState({ isPlanning: false, errorMessage: error instanceof Error ? error.message : "Couldn't plan a route" })
    }
  }

  // --- Add Charge ---
  // Address search + EV/Public, that's it — the geocoded address label
  // doubles as the spot's name, matching the simplified Android design.

  function onSubmitChargePointAddressQueryChanged(query: string) {
    setState({ submitChargePointAddressQuery: query, submitChargePointSelectedAddress: null })
    if (submitChargePointSearchTimer.current) clearTimeout(submitChargePointSearchTimer.current)
    if (query.trim().length < 3) {
      setState({ submitChargePointAddressResults: [] })
      return
    }
    submitChargePointSearchTimer.current = setTimeout(async () => {
      const results = await geocodeSearch(query)
      setState({ submitChargePointAddressResults: results })
    }, SEARCH_DEBOUNCE_MS)
  }

  function selectSubmitChargePointAddress(result: GeocodeResult) {
    setState({
      submitChargePointSelectedAddress: result,
      submitChargePointAddressQuery: result.label,
      submitChargePointAddressResults: [],
    })
  }

  function onSubmitChargePointCategoryChanged(category: 'EV' | 'PUBLIC') {
    setState({ submitChargePointCategory: category })
  }

  function openSubmitChargePointForm() {
    if (submitChargePointSearchTimer.current) clearTimeout(submitChargePointSearchTimer.current)
    setState({
      showSubmitChargePointForm: true,
      submitChargePointAddressQuery: '',
      submitChargePointAddressResults: [],
      submitChargePointSelectedAddress: null,
      submitChargePointCategory: 'EV',
    })
  }

  function closeSubmitChargePointForm() {
    if (submitChargePointSearchTimer.current) clearTimeout(submitChargePointSearchTimer.current)
    setState({ showSubmitChargePointForm: false })
  }

  async function submitChargePoint() {
    const current = stateRef.current
    const address = current.submitChargePointSelectedAddress
    if (!address) {
      setState({ errorMessage: 'Search for the address and pick a result first.' })
      return
    }

    setState({ isSubmittingChargePoint: true, errorMessage: null })
    try {
      await chargePointRepository.submitChargePoint(
        current.riderId,
        address.label,
        address.location,
        current.submitChargePointCategory,
      )
      setState({
        isSubmittingChargePoint: false,
        showSubmitChargePointForm: false,
        submitChargePointAddressQuery: '',
        submitChargePointSelectedAddress: null,
      })
    } catch (error) {
      setState({
        isSubmittingChargePoint: false,
        errorMessage: error instanceof Error ? error.message : "Couldn't submit that spot",
      })
    }
  }

  // --- View submitted spots ---

  async function refreshSubmittedSpots() {
    const current = stateRef.current
    const location = current.liveLocation ?? current.origin
    if (!location) return
    setState({ isFetchingSubmittedSpots: true })
    try {
      const results = await chargePointRepository.submittedChargePointsNear(location, 15.0)
      results.sort((a, b) => distanceMeters(location, a.location) - distanceMeters(location, b.location))
      setState({ isFetchingSubmittedSpots: false, submittedSpotsOptions: results })
    } catch (error) {
      console.error('refreshSubmittedSpots failed:', error)
      setState({ isFetchingSubmittedSpots: false, submittedSpotsOptions: [] })
    }
  }

  function openViewSubmittedSpots() {
    const current = stateRef.current
    if (!current.liveLocation && !current.origin) {
      setState({ errorMessage: 'Waiting on your current location.' })
      return
    }
    setState({ showViewSubmittedSpots: true })
    void refreshSubmittedSpots()
  }

  function closeViewSubmittedSpots() {
    setState({ showViewSubmittedSpots: false, submittedSpotsOptions: [] })
  }

  function flagSubmittedChargePoint(chargePoint: ChargePoint) {
    void chargePointRepository
      .flagChargePoint(chargePoint.id)
      .catch((error) => console.error('flagChargePoint failed:', error))
      .then(() => refreshSubmittedSpots())
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
    connectWheel,
    disconnectWheel,
    startExploring,
    stopExploring,
    onExplorationVoltageThresholdChanged,
    acceptLowBatteryRedirect,
    dismissLowBatteryAlert,
    routeToNearestChargeStation,
    onSubmitChargePointAddressQueryChanged,
    selectSubmitChargePointAddress,
    onSubmitChargePointCategoryChanged,
    openSubmitChargePointForm,
    closeSubmitChargePointForm,
    submitChargePoint,
    openViewSubmittedSpots,
    closeViewSubmittedSpots,
    flagSubmittedChargePoint,
  }
}

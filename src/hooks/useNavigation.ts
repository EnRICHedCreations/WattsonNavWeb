import { useEffect, useRef } from 'react'
import { useStore } from './useStore'
import { useGeolocation } from './useGeolocation'
import {
  cumulativeDistances,
  distanceMeters,
  nearestPointIndex,
  type LatLng,
} from '../lib/geo/geoMath'
import type { ChargePoint, ChargeStationFilter, GeocodeResult, PitstopPlan } from '../lib/domain'
import { geocodeSearch } from '../lib/api/ors'
import { plan as planRouteInternal } from '../lib/pitstopPlanner'

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
  }

  function onChargeStationFilterChanged(filter: ChargeStationFilter) {
    setState({ chargeStationFilter: filter })
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
  }

  function stopNavigation() {
    previousFixLocationRef.current = null
    setState({ isNavigating: false })
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
    onPitstopTapped,
    clearSelectedPitstop,
    clearArrivalMessage,
    planRoute,
    startNavigation,
    stopNavigation,
  }
}

import { useState } from 'react'
import type { NavState } from '../hooks/useNavigation'
import SearchBar from './SearchBar'
import ChargeIntervalControl from './ChargeIntervalControl'
import ChargeStationFilterControl from './ChargeStationFilterControl'
import RouteOverviewSheet from './RouteOverviewSheet'
import TripHistoryList from './TripHistoryList'
import GroupRideControls from './GroupRideControls'
import type { GeocodeResult } from '../lib/domain'
import type { TripHistoryEntry } from '../lib/db/tripHistory'

interface ControlsPanelProps {
  state: NavState
  onOriginQueryChanged: (query: string) => void
  selectOrigin: (result: GeocodeResult) => void
  clearOrigin: () => void
  onDestinationQueryChanged: (query: string) => void
  selectDestination: (result: GeocodeResult) => void
  onChargeIntervalChanged: (miles: number) => void
  onChargeStationFilterChanged: (filter: NavState['chargeStationFilter']) => void
  selectHistoryEntry: (trip: TripHistoryEntry) => void
  planRoute: () => void
  startNavigation: () => void
  displayName: string
  onDisplayNameChange: (name: string) => void
  startGroupRide: () => void
  joinGroupRide: (code: string) => void
}

export default function ControlsPanel({
  state,
  onOriginQueryChanged,
  selectOrigin,
  clearOrigin,
  onDestinationQueryChanged,
  selectDestination,
  onChargeIntervalChanged,
  onChargeStationFilterChanged,
  selectHistoryEntry,
  planRoute,
  startNavigation,
  displayName,
  onDisplayNameChange,
  startGroupRide,
  joinGroupRide,
}: ControlsPanelProps) {
  const [showHistory, setShowHistory] = useState(false)

  return (
    <div className="controls-panel">
      <div className="card">
        <SearchBar
          query={state.originQuery}
          results={state.originGeocodeResults}
          onQueryChange={onOriginQueryChanged}
          onResultSelected={selectOrigin}
          placeholder="Starting point (default: current location)"
        />
        {state.selectedOrigin && (
          <button className="text-button" onClick={clearOrigin}>
            Use current location instead
          </button>
        )}

        <SearchBar
          query={state.destinationQuery}
          results={state.geocodeResults}
          onQueryChange={onDestinationQueryChanged}
          onResultSelected={selectDestination}
        />

        <ChargeIntervalControl intervalMiles={state.chargeIntervalMiles} onIntervalChange={onChargeIntervalChanged} />
        <ChargeStationFilterControl selected={state.chargeStationFilter} onSelectedChange={onChargeStationFilterChanged} />

        <div className="button-row">
          <button className="primary-button" onClick={planRoute} disabled={state.isPlanning}>
            {state.isPlanning ? 'Planning…' : 'Plan route'}
          </button>
          {state.recentTrips.length > 0 && (
            <button className="secondary-button" onClick={() => setShowHistory((v) => !v)}>
              History
            </button>
          )}
        </div>

        {showHistory && (
          <TripHistoryList
            trips={state.recentTrips}
            onSelect={(trip) => {
              selectHistoryEntry(trip)
              setShowHistory(false)
            }}
          />
        )}

        {state.errorMessage && <div className="error-text">{state.errorMessage}</div>}
      </div>

      {state.pitstopPlan && (
        <>
          <RouteOverviewSheet plan={state.pitstopPlan} />
          <button className="primary-button" onClick={startNavigation}>
            {state.selectedOrigin ? 'Preview route' : 'Start navigation'}
          </button>
        </>
      )}

      <GroupRideControls
        hasPlan={state.pitstopPlan != null}
        isBusy={state.isJoiningGroup}
        error={state.groupError}
        displayName={displayName}
        onDisplayNameChange={onDisplayNameChange}
        onStart={startGroupRide}
        onJoin={joinGroupRide}
      />
    </div>
  )
}


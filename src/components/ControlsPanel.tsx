import { useState } from 'react'
import type { NavState } from '../hooks/useNavigation'
import SearchBar from './SearchBar'
import ChargeIntervalControl from './ChargeIntervalControl'
import ChargeStationFilterControl from './ChargeStationFilterControl'
import RouteOverviewSheet from './RouteOverviewSheet'
import TripHistoryList from './TripHistoryList'
import GroupRideControls from './GroupRideControls'
import type { ChargePoint, GeocodeResult } from '../lib/domain'
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
  connectWheel: () => void
  disconnectWheel: () => void
  onWheelCellCountChanged: (cellCount: number) => void
  startExploring: () => void
  onExplorationVoltageThresholdChanged: (value: string) => void
  routeToNearestChargeStation: () => void
  onSubmitChargePointAddressQueryChanged: (query: string) => void
  selectSubmitChargePointAddress: (result: GeocodeResult) => void
  onSubmitChargePointCategoryChanged: (category: 'EV' | 'PUBLIC') => void
  openSubmitChargePointForm: () => void
  closeSubmitChargePointForm: () => void
  submitChargePoint: () => void
  openViewSubmittedSpots: () => void
  closeViewSubmittedSpots: () => void
  flagSubmittedChargePoint: (chargePoint: ChargePoint) => void
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
  connectWheel,
  disconnectWheel,
  onWheelCellCountChanged,
  startExploring,
  onExplorationVoltageThresholdChanged,
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

      <div className="card">
        <h3>Charge</h3>
        <div className="button-row">
          <button className="secondary-button" onClick={routeToNearestChargeStation}>
            Charge
          </button>
          <button className="secondary-button" onClick={openSubmitChargePointForm}>
            Add Charge
          </button>
        </div>
        <button className="text-button" onClick={openViewSubmittedSpots}>
          View submitted spots
        </button>
      </div>

      <div className="card">
        <h3>Explore (no destination)</h3>
        <input
          className="search-input"
          type="text"
          placeholder="Auto-redirect at voltage (optional)"
          value={state.explorationVoltageThresholdInput}
          onChange={(e) => onExplorationVoltageThresholdChanged(e.target.value)}
        />
        <div className="button-row">
          <button className="primary-button" onClick={startExploring}>
            Start Exploring
          </button>
        </div>
        <p className="hint-text">
          No destination needed — tracks your ride and announces direction changes. Connect a wheel below to see live
          Wh/mile. Leave voltage blank to skip auto-redirect alerts.
        </p>
      </div>

      <div className="card">
        <h3>Wheel Connection</h3>
        <p className="hint-text">
          Begode/Gotway only. Requires Chrome (desktop or Android) — Web Bluetooth doesn't exist on iOS Safari at all,
          an Apple platform limitation, not something this app can work around. Connection code hasn't been run
          against real hardware yet.
        </p>
        <input
          className="search-input"
          type="number"
          placeholder="Pack cell count (e.g. 16, 20, 24, 32)"
          value={state.wheelCellCount}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10)
            if (!isNaN(parsed) && parsed > 0) onWheelCellCountChanged(parsed)
          }}
        />
        <p className="hint-text">
          Stock packs are usually 16S. If voltage readings look wrong once connected, check your wheel's actual pack
          configuration rather than assume 16S.
        </p>
        {state.wheelConnectionState === 'DISCONNECTED' || state.wheelConnectionState === 'FAILED' ? (
          <button className="secondary-button" onClick={connectWheel}>
            Connect wheel
          </button>
        ) : state.wheelConnectionState === 'CONNECTING' ? (
          <button className="secondary-button" disabled>
            Connecting…
          </button>
        ) : (
          <button className="secondary-button" onClick={disconnectWheel}>
            Disconnect
          </button>
        )}
        {state.wheelConnectionState === 'FAILED' && (
          <p className="error-text">{state.errorMessage ?? 'Connection failed — check that the wheel is on and in range, and try again.'}</p>
        )}
        {state.wheelTelemetry && (
          <div className="wheel-telemetry">
            {state.wheelTelemetry.voltageVolts != null && (
              <p>
                Voltage: {state.wheelTelemetry.voltageVolts.toFixed(1)}V
                {state.wheelTelemetry.voltageFromBms ? ' (BMS)' : ''}
              </p>
            )}
            {state.wheelTelemetry.currentAmps != null && (
              <p>
                Current: {state.wheelTelemetry.currentAmps.toFixed(1)}A
                {state.wheelTelemetry.currentIsPackCurrent ? ' (pack)' : ' (phase, approximate)'}
              </p>
            )}
            {state.wheelTelemetry.speedMph != null && <p>Speed: {state.wheelTelemetry.speedMph.toFixed(1)} mph</p>}
            {state.wheelWhPerMile != null && (
              <p className="emphasize">Rolling efficiency: {Math.round(state.wheelWhPerMile)} Wh/mile</p>
            )}
          </div>
        )}
      </div>

      <GroupRideControls
        hasPlan={state.pitstopPlan != null}
        isBusy={state.isJoiningGroup}
        error={state.groupError}
        displayName={displayName}
        onDisplayNameChange={onDisplayNameChange}
        onStart={startGroupRide}
        onJoin={joinGroupRide}
      />

      {state.showSubmitChargePointForm && (
        <div className="modal-overlay">
          <div className="card modal-card">
            <h3>Add Charge</h3>
            <SearchBar
              query={state.submitChargePointAddressQuery}
              results={state.submitChargePointAddressResults}
              onQueryChange={onSubmitChargePointAddressQueryChanged}
              onResultSelected={selectSubmitChargePointAddress}
              placeholder="Address"
            />
            <div className="button-row">
              <label>
                <input
                  type="radio"
                  checked={state.submitChargePointCategory === 'EV'}
                  onChange={() => onSubmitChargePointCategoryChanged('EV')}
                />
                EV charger
              </label>
              <label>
                <input
                  type="radio"
                  checked={state.submitChargePointCategory === 'PUBLIC'}
                  onChange={() => onSubmitChargePointCategoryChanged('PUBLIC')}
                />
                Public outlet
              </label>
            </div>
            <div className="button-row">
              <button
                className="primary-button"
                onClick={submitChargePoint}
                disabled={state.isSubmittingChargePoint || !state.submitChargePointSelectedAddress}
              >
                {state.isSubmittingChargePoint ? 'Adding…' : 'Add'}
              </button>
              <button className="text-button" onClick={closeSubmitChargePointForm}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {state.showViewSubmittedSpots && (
        <div className="modal-overlay">
          <div className="card modal-card">
            <div className="button-row" style={{ justifyContent: 'space-between' }}>
              <h3>Rider-submitted spots</h3>
              <button className="text-button" onClick={closeViewSubmittedSpots}>
                Close
              </button>
            </div>
            {state.isFetchingSubmittedSpots ? (
              <p>Looking nearby…</p>
            ) : state.submittedSpotsOptions.length === 0 ? (
              <p>No rider-submitted spots nearby yet.</p>
            ) : (
              <ul className="submitted-spots-list">
                {state.submittedSpotsOptions.map((station) => (
                  <li key={station.id}>
                    <div>
                      <p>{station.name}</p>
                      <p className="hint-text">{station.source === 'NLR' ? 'EV charger' : 'Public outlet'}</p>
                    </div>
                    <button className="text-button" onClick={() => flagSubmittedChargePoint(station)}>
                      Flag
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

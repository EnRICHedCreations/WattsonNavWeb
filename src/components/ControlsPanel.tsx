import type { NavState } from '../hooks/useNavigation'
import SearchBar from './SearchBar'
import ChargeIntervalControl from './ChargeIntervalControl'
import ChargeStationFilterControl from './ChargeStationFilterControl'
import RouteOverviewSheet from './RouteOverviewSheet'
import type { GeocodeResult } from '../lib/domain'

interface ControlsPanelProps {
  state: NavState
  onOriginQueryChanged: (query: string) => void
  selectOrigin: (result: GeocodeResult) => void
  clearOrigin: () => void
  onDestinationQueryChanged: (query: string) => void
  selectDestination: (result: GeocodeResult) => void
  onChargeIntervalChanged: (miles: number) => void
  onChargeStationFilterChanged: (filter: NavState['chargeStationFilter']) => void
  planRoute: () => void
  startNavigation: () => void
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
  planRoute,
  startNavigation,
}: ControlsPanelProps) {
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

        <button className="primary-button" onClick={planRoute} disabled={state.isPlanning}>
          {state.isPlanning ? 'Planning…' : 'Plan route'}
        </button>

        {state.errorMessage && <div className="error-text">{state.errorMessage}</div>}
      </div>

      {state.pitstopPlan && (
        <>
          <RouteOverviewSheet plan={state.pitstopPlan} />
          <button className="primary-button" onClick={startNavigation}>
            Start navigation
          </button>
        </>
      )}
    </div>
  )
}

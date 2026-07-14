import { useEffect } from 'react'
import MapView from './components/MapView'
import ControlsPanel from './components/ControlsPanel'
import TurnInstructionBanner from './components/TurnInstructionBanner'
import NextPitstopChip from './components/NextPitstopChip'
import PitstopInfoCard from './components/PitstopInfoCard'
import { useNavigation } from './hooks/useNavigation'

function App() {
  const {
    state,
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
  } = useNavigation()

  // Arrival banner auto-clears after a few seconds, same as the Android app.
  useEffect(() => {
    if (!state.arrivalMessage) return
    const timer = setTimeout(clearArrivalMessage, 5000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.arrivalMessage])

  const currentStep = state.pitstopPlan?.route.steps[state.currentStepIndex] ?? null

  return (
    <div className="app-root">
      <MapView
        liveLocation={state.liveLocation}
        puckBearingDegrees={state.puckBearingDegrees}
        pitstopPlan={state.pitstopPlan}
        isNavigating={state.isNavigating}
        onPitstopTap={onPitstopTapped}
      />

      {geoError && <div className="banner error-banner">{geoError}</div>}

      {state.isNavigating ? (
        <div className="nav-overlay">
          <TurnInstructionBanner step={currentStep} isRerouting={state.isRerouting} />
          {state.nextPitstopName && state.distanceToNextPitstopMeters != null && (
            <NextPitstopChip name={state.nextPitstopName} distanceMeters={state.distanceToNextPitstopMeters} />
          )}
          {state.arrivalMessage && <div className="card arrival-banner">{state.arrivalMessage}</div>}
          <button className="stop-button" onClick={stopNavigation}>
            Stop
          </button>
        </div>
      ) : (
        <ControlsPanel
          state={state}
          onOriginQueryChanged={onOriginQueryChanged}
          selectOrigin={selectOrigin}
          clearOrigin={clearOrigin}
          onDestinationQueryChanged={onDestinationQueryChanged}
          selectDestination={selectDestination}
          onChargeIntervalChanged={onChargeIntervalChanged}
          onChargeStationFilterChanged={onChargeStationFilterChanged}
          planRoute={planRoute}
          startNavigation={startNavigation}
        />
      )}

      {state.selectedPitstop && (
        <div className="pitstop-info-overlay">
          <PitstopInfoCard chargePoint={state.selectedPitstop} onDismiss={clearSelectedPitstop} />
        </div>
      )}
    </div>
  )
}

export default App

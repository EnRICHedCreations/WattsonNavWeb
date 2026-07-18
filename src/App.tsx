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
  } = useNavigation()

  // Arrival banner auto-clears after a few seconds, same as the Android app.
  useEffect(() => {
    if (!state.arrivalMessage) return
    const timer = setTimeout(clearArrivalMessage, 5000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.arrivalMessage])

  const currentStep = state.pitstopPlan?.route.steps[state.currentStepIndex] ?? null
  const isPreview = state.selectedOrigin != null

  return (
    <div className="app-root">
      <MapView
        liveLocation={state.liveLocation}
        puckBearingDegrees={state.puckBearingDegrees}
        pitstopPlan={state.pitstopPlan}
        isNavigating={state.isNavigating || state.isExploring}
        isPreview={isPreview}
        teammatePositions={state.teammatePositions}
        onPitstopTap={onPitstopTapped}
      />

      {geoError && <div className="banner error-banner">{geoError}</div>}

      {state.isNavigating ? (
        <div className="nav-overlay">
          {isPreview ? (
            <div className="card preview-banner">
              <div className="turn-instruction">Previewing route from {state.selectedOrigin?.label}</div>
              <div className="hint-text">
                This route starts somewhere other than your current location, so it's shown as a preview —
                turn-by-turn tracking and rerouting are off. Clear the starting point to navigate live.
              </div>
            </div>
          ) : (
            <>
              <TurnInstructionBanner step={currentStep} isRerouting={state.isRerouting} />
              {state.nextPitstopName && state.distanceToNextPitstopMeters != null && (
                <NextPitstopChip name={state.nextPitstopName} distanceMeters={state.distanceToNextPitstopMeters} />
              )}
            </>
          )}

          {state.groupSession && (
            <div className="card group-status-chip">
              Group code: {state.groupSession.joinCode} · {state.teammatePositions.length} teammate(s)
            </div>
          )}

          {state.arrivalMessage && <div className="card arrival-banner">{state.arrivalMessage}</div>}

          {state.waitForMeMessage && (
            <div className="card wait-for-me-banner">
              <div>{state.waitForMeMessage}</div>
              <button className="text-button" onClick={clearWaitForMeMessage}>
                Ok
              </button>
            </div>
          )}

          <div className="nav-button-row">
            {state.groupSession && (
              <button className="secondary-button" onClick={sendWaitForMe}>
                Wait for me
              </button>
            )}
            {state.groupSession && (
              <button className="secondary-button" onClick={leaveGroupRide}>
                Leave group
              </button>
            )}
            <button className="secondary-button" onClick={routeToNearestChargeStation}>
              Charge
            </button>
            <button className="stop-button" onClick={stopNavigation}>
              Stop
            </button>
          </div>
        </div>
      ) : state.isExploring ? (
        <div className="nav-overlay">
          {state.explorationLowBatteryAlertMessage && (
            <div className="card low-battery-alert">
              <div>{state.explorationLowBatteryAlertMessage}</div>
              <div className="button-row">
                <button className="primary-button" onClick={acceptLowBatteryRedirect}>
                  Route me there
                </button>
                <button className="text-button" onClick={dismissLowBatteryAlert}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="card exploring-card">
            <div className="turn-instruction">Exploring</div>
            <div>{(state.explorationDistanceMeters / 1609.344).toFixed(2)} mi this ride</div>
            {state.explorationDirectionMessage && <div>{state.explorationDirectionMessage}</div>}
            {state.wheelConnectionState === 'CONNECTED' ? (
              <>
                {state.wheelWhPerMile != null && (
                  <div className="emphasize">{Math.round(state.wheelWhPerMile)} Wh/mile (rolling)</div>
                )}
                {state.wheelTelemetry?.voltageVolts != null && <div>{state.wheelTelemetry.voltageVolts.toFixed(1)}V</div>}
              </>
            ) : (
              <div className="hint-text">No wheel connected — connect one from the main screen to see Wh/mile.</div>
            )}
          </div>

          <div className="nav-button-row">
            <button className="secondary-button" onClick={routeToNearestChargeStation}>
              Charge
            </button>
            <button className="stop-button" onClick={stopExploring}>
              Stop
            </button>
          </div>
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
          selectHistoryEntry={selectHistoryEntry}
          planRoute={planRoute}
          startNavigation={startNavigation}
          displayName={state.displayName}
          onDisplayNameChange={setDisplayName}
          startGroupRide={startGroupRide}
          joinGroupRide={joinGroupRide}
          connectWheel={connectWheel}
          disconnectWheel={disconnectWheel}
          startExploring={startExploring}
          onExplorationVoltageThresholdChanged={onExplorationVoltageThresholdChanged}
          routeToNearestChargeStation={routeToNearestChargeStation}
          onSubmitChargePointAddressQueryChanged={onSubmitChargePointAddressQueryChanged}
          selectSubmitChargePointAddress={selectSubmitChargePointAddress}
          onSubmitChargePointCategoryChanged={onSubmitChargePointCategoryChanged}
          openSubmitChargePointForm={openSubmitChargePointForm}
          closeSubmitChargePointForm={closeSubmitChargePointForm}
          submitChargePoint={submitChargePoint}
          openViewSubmittedSpots={openViewSubmittedSpots}
          closeViewSubmittedSpots={closeViewSubmittedSpots}
          flagSubmittedChargePoint={flagSubmittedChargePoint}
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

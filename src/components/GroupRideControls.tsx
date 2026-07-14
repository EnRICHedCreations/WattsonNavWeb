import { useState } from 'react'

interface GroupRideControlsProps {
  hasPlan: boolean
  isBusy: boolean
  error: string | null
  displayName: string
  onDisplayNameChange: (name: string) => void
  onStart: () => void
  onJoin: (code: string) => void
}

export default function GroupRideControls({
  hasPlan,
  isBusy,
  error,
  displayName,
  onDisplayNameChange,
  onStart,
  onJoin,
}: GroupRideControlsProps) {
  const [joinCodeInput, setJoinCodeInput] = useState('')

  return (
    <div className="card group-ride-controls">
      <div className="route-summary">Group ride</div>

      <input
        className="search-input"
        type="text"
        placeholder="Your name"
        value={displayName}
        onChange={(e) => onDisplayNameChange(e.target.value)}
        style={{ marginTop: 8, marginBottom: 8 }}
      />

      {hasPlan ? (
        <button className="primary-button" onClick={onStart} disabled={isBusy}>
          {isBusy ? 'Starting…' : 'Start group ride'}
        </button>
      ) : (
        <div className="hint-text">Plan a route first to start a group ride.</div>
      )}

      <div className="button-row" style={{ marginTop: 8 }}>
        <input
          className="search-input"
          type="text"
          placeholder="Join code"
          value={joinCodeInput}
          onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
        />
        <button
          className="secondary-button"
          onClick={() => {
            console.log('Join button clicked, joinCodeInput:', JSON.stringify(joinCodeInput), 'isBusy:', isBusy)
            onJoin(joinCodeInput)
          }}
          disabled={isBusy}
        >
          {isBusy ? 'Joining…' : 'Join'}
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
    </div>
  )
}

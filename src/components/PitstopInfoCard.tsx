import type { ChargePoint } from '../lib/domain'

interface PitstopInfoCardProps {
  chargePoint: ChargePoint
  onDismiss: () => void
}

export default function PitstopInfoCard({ chargePoint, onDismiss }: PitstopInfoCardProps) {
  return (
    <div className="card pitstop-info">
      <div className="pitstop-info-name">{chargePoint.name}</div>
      {chargePoint.connectorTypes.length > 0 && (
        <div>Connectors: {chargePoint.connectorTypes.join(', ')}</div>
      )}
      {chargePoint.networkName && <div>Network: {chargePoint.networkName}</div>}
      <button className="text-button" onClick={onDismiss}>
        Close
      </button>
    </div>
  )
}

import type { RouteStep } from '../lib/domain'

interface TurnInstructionBannerProps {
  step: RouteStep | null
  isRerouting: boolean
}

export default function TurnInstructionBanner({ step, isRerouting }: TurnInstructionBannerProps) {
  if (!step && !isRerouting) return null

  return (
    <div className="card turn-banner">
      {isRerouting ? (
        <div className="turn-instruction">Rerouting…</div>
      ) : (
        step && (
          <>
            <div className="turn-instruction">{step.instruction}</div>
            <div className="turn-distance">{Math.round(step.distanceMeters)} m</div>
          </>
        )
      )}
    </div>
  )
}

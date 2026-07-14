import type { PitstopPlan } from '../lib/domain'
import { METERS_PER_MILE } from '../lib/geo/geoMath'

interface RouteOverviewSheetProps {
  plan: PitstopPlan
}

interface MileageLeg {
  label: string
  legMiles: number
  cumulativeMiles: number
}

function buildMileageLegs(plan: PitstopPlan): MileageLeg[] {
  if (plan.pitstops.length === 0) return []

  const legs: MileageLeg[] = []
  let previousCumulativeMeters = 0

  plan.pitstops.forEach((pitstop, index) => {
    const cumulativeMeters = pitstop.distanceFromStartMeters
    const legMeters = cumulativeMeters - previousCumulativeMeters
    const fromLabel = index === 0 ? 'Start' : plan.pitstops[index - 1].chargePoint.name
    legs.push({
      label: `${fromLabel} → ${pitstop.chargePoint.name}`,
      legMiles: legMeters / METERS_PER_MILE,
      cumulativeMiles: cumulativeMeters / METERS_PER_MILE,
    })
    previousCumulativeMeters = cumulativeMeters
  })

  const finalLegMeters = plan.route.distanceMeters - previousCumulativeMeters
  legs.push({
    label: `${plan.pitstops[plan.pitstops.length - 1].chargePoint.name} → Destination`,
    legMiles: finalLegMeters / METERS_PER_MILE,
    cumulativeMiles: plan.route.distanceMeters / METERS_PER_MILE,
  })

  return legs
}

const fmt = (miles: number) => miles.toFixed(1)

export default function RouteOverviewSheet({ plan }: RouteOverviewSheetProps) {
  const totalMiles = plan.route.distanceMeters / METERS_PER_MILE
  const minutes = Math.round(plan.route.durationSeconds / 60)
  const legs = buildMileageLegs(plan)

  return (
    <div className="card route-overview">
      <div className="route-summary">
        {fmt(totalMiles)} mi · {minutes} min
      </div>

      {legs.length > 0 && (
        <>
          <hr />
          {legs.map((leg) => (
            <div className="mileage-leg" key={leg.label}>
              <span>{leg.label}</span>
              <span className="mileage-leg-distance">
                {fmt(leg.legMiles)} mi ({fmt(leg.cumulativeMiles)} mi total)
              </span>
            </div>
          ))}
        </>
      )}

      {plan.route.steps.length > 0 && (
        <>
          <hr />
          <div className="turn-list">
            {plan.route.steps.map((step, i) => (
              <div className="turn-list-item" key={i}>
                <span>{step.instruction}</span>
                <span className="turn-list-distance">{Math.round(step.distanceMeters)} m</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

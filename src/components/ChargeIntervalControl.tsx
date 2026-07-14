interface ChargeIntervalControlProps {
  intervalMiles: number
  onIntervalChange: (miles: number) => void
}

const STEP_MILES = 5
const MIN_MILES = 5
const MAX_MILES = 100

export default function ChargeIntervalControl({ intervalMiles, onIntervalChange }: ChargeIntervalControlProps) {
  return (
    <div className="interval-control">
      <span>Charge every</span>
      <button onClick={() => onIntervalChange(Math.max(MIN_MILES, intervalMiles - STEP_MILES))}>–</button>
      <span className="interval-value">{intervalMiles} mi</span>
      <button onClick={() => onIntervalChange(Math.min(MAX_MILES, intervalMiles + STEP_MILES))}>+</button>
    </div>
  )
}

import type { ChargeStationFilter } from '../lib/domain'

interface ChargeStationFilterControlProps {
  selected: ChargeStationFilter
  onSelectedChange: (filter: ChargeStationFilter) => void
}

const OPTIONS: Array<{ value: ChargeStationFilter; label: string }> = [
  { value: 'EV_ONLY', label: 'EV' },
  { value: 'PUBLIC_ONLY', label: 'Public' },
  { value: 'BOTH', label: 'Both' },
]

export default function ChargeStationFilterControl({ selected, onSelectedChange }: ChargeStationFilterControlProps) {
  return (
    <div className="segmented-control">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          className={option.value === selected ? 'segmented-option selected' : 'segmented-option'}
          onClick={() => onSelectedChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

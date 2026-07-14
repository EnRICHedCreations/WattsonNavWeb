import { METERS_PER_MILE } from '../lib/geo/geoMath'

interface NextPitstopChipProps {
  name: string
  distanceMeters: number
}

export default function NextPitstopChip({ name, distanceMeters }: NextPitstopChipProps) {
  const miles = distanceMeters / METERS_PER_MILE
  return (
    <div className="card next-pitstop-chip">
      Next charge: {name} — {miles.toFixed(1)} mi
    </div>
  )
}

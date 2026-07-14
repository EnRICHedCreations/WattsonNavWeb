import type { TripHistoryEntry } from '../lib/db/tripHistory'
import { METERS_PER_MILE } from '../lib/geo/geoMath'

interface TripHistoryListProps {
  trips: TripHistoryEntry[]
  onSelect: (trip: TripHistoryEntry) => void
}

export default function TripHistoryList({ trips, onSelect }: TripHistoryListProps) {
  if (trips.length === 0) return null

  return (
    <div className="trip-history-list">
      {trips.map((trip) => {
        const miles = trip.totalDistanceMeters / METERS_PER_MILE
        const dateLabel = new Date(trip.createdAtEpochMillis).toLocaleDateString()
        return (
          <button key={trip.id} className="trip-history-item" onClick={() => onSelect(trip)}>
            <div className="trip-history-destination">{trip.destination.label}</div>
            <div className="trip-history-meta">
              {miles.toFixed(1)} mi · {dateLabel}
            </div>
          </button>
        )
      })}
    </div>
  )
}

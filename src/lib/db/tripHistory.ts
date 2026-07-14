import { get, set } from 'idb-keyval'
import type { LatLng } from '../geo/geoMath'
import type { GeocodeResult } from '../domain'

const TRIP_HISTORY_KEY = 'wattson-trip-history'
const MAX_ENTRIES = 20

export interface TripHistoryEntry {
  id: string
  origin: LatLng
  destination: GeocodeResult
  chargeIntervalMiles: number
  totalDistanceMeters: number
  createdAtEpochMillis: number
}

async function loadAll(): Promise<TripHistoryEntry[]> {
  return (await get<TripHistoryEntry[]>(TRIP_HISTORY_KEY)) ?? []
}

export async function saveTrip(entry: Omit<TripHistoryEntry, 'id' | 'createdAtEpochMillis'>): Promise<void> {
  const all = await loadAll()
  const newEntry: TripHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAtEpochMillis: Date.now(),
  }
  const updated = [newEntry, ...all].slice(0, MAX_ENTRIES)
  await set(TRIP_HISTORY_KEY, updated)
}

export async function getRecentTrips(limit = 10): Promise<TripHistoryEntry[]> {
  const all = await loadAll()
  return all.slice(0, limit)
}

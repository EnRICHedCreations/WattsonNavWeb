import { get, set } from 'idb-keyval'
import type { ChargeStationFilter } from '../domain'

const CHARGE_INTERVAL_KEY = 'wattson-charge-interval-miles'
const CHARGE_FILTER_KEY = 'wattson-charge-station-filter'
const WHEEL_CELL_COUNT_KEY = 'wattson-wheel-cell-count'

export async function getChargeIntervalMiles(defaultValue: number): Promise<number> {
  const stored = await get<number>(CHARGE_INTERVAL_KEY)
  return stored ?? defaultValue
}

export async function setChargeIntervalMiles(miles: number): Promise<void> {
  await set(CHARGE_INTERVAL_KEY, miles)
}

export async function getChargeStationFilter(defaultValue: ChargeStationFilter): Promise<ChargeStationFilter> {
  const stored = await get<ChargeStationFilter>(CHARGE_FILTER_KEY)
  return stored ?? defaultValue
}

export async function setChargeStationFilter(filter: ChargeStationFilter): Promise<void> {
  await set(CHARGE_FILTER_KEY, filter)
}

/** Cell count for scaling the wheel's raw voltage reading — same rationale
 * as the Android app's UserPreferencesRepository.getWheelCellCount: a
 * generic per-cell formula didn't hold up for battery percentage
 * calibration elsewhere in this project, so voltage scaling needs the
 * rider's actual confirmed cell count rather than an assumed default. */
export async function getWheelCellCount(defaultValue = 16): Promise<number> {
  const stored = await get<number>(WHEEL_CELL_COUNT_KEY)
  return stored ?? defaultValue
}

export async function setWheelCellCount(cellCount: number): Promise<void> {
  await set(WHEEL_CELL_COUNT_KEY, cellCount)
}

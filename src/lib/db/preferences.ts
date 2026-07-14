import { get, set } from 'idb-keyval'
import type { ChargeStationFilter } from '../domain'

const CHARGE_INTERVAL_KEY = 'wattson-charge-interval-miles'
const CHARGE_FILTER_KEY = 'wattson-charge-station-filter'

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

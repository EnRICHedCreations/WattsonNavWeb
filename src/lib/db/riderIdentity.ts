import { get, set } from 'idb-keyval'

const RIDER_ID_KEY = 'wattson-rider-id'
const DISPLAY_NAME_KEY = 'wattson-display-name'

export async function getRiderId(): Promise<string> {
  const existing = await get<string>(RIDER_ID_KEY)
  if (existing) return existing
  const generated = crypto.randomUUID()
  await set(RIDER_ID_KEY, generated)
  return generated
}

export async function getDisplayName(defaultValue = 'Rider'): Promise<string> {
  const stored = await get<string>(DISPLAY_NAME_KEY)
  return stored ?? defaultValue
}

export async function setDisplayName(name: string): Promise<void> {
  await set(DISPLAY_NAME_KEY, name)
}

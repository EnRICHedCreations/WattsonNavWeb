export const METERS_PER_MILE = 1609.344
const MILLIS_PER_HOUR = 3_600_000

interface Sample {
  timestampMillis: number
  cumulativeDistanceMeters: number
  powerWatts: number
}

/**
 * Rolling-window Wh/mile calculator — direct port of the Android app's
 * WhPerMileCalculator.kt. Recomputes the energy integral from scratch over
 * whatever samples currently sit in the window on every call, rather than
 * maintaining an incrementally-adjusted running total, for the same reason
 * as the Kotlin version: window sizes are small (tens of samples at typical
 * GPS+telemetry rates), so the recompute is cheap, and it avoids any risk
 * of floating-point drift accumulating over a long ride.
 */
export class WhPerMileCalculator {
  private samples: Sample[] = []
  private readonly windowMeters: number

  constructor(windowMeters: number = METERS_PER_MILE) {
    this.windowMeters = windowMeters
  }

  /** Feed a new sample; returns the current rolling Wh/mile, or null if the
   * window doesn't yet span enough distance to compute a meaningful rate. */
  addSample(timestampMillis: number, cumulativeDistanceMeters: number, powerWatts: number): number | null {
    this.samples.push({ timestampMillis, cumulativeDistanceMeters, powerWatts })
    while (
      this.samples.length > 1 &&
      cumulativeDistanceMeters - this.samples[0].cumulativeDistanceMeters > this.windowMeters
    ) {
      this.samples.shift()
    }
    if (this.samples.length < 2) return null

    let wattHours = 0
    for (let i = 1; i < this.samples.length; i++) {
      const prev = this.samples[i - 1]
      const curr = this.samples[i]
      const dtHours = (curr.timestampMillis - prev.timestampMillis) / MILLIS_PER_HOUR
      if (dtHours <= 0) continue
      const avgPowerWatts = (prev.powerWatts + curr.powerWatts) / 2
      wattHours += avgPowerWatts * dtHours
    }

    const windowDistanceMeters = cumulativeDistanceMeters - this.samples[0].cumulativeDistanceMeters
    if (windowDistanceMeters <= 0) return null
    const windowMiles = windowDistanceMeters / METERS_PER_MILE
    return wattHours / windowMiles
  }

  reset(): void {
    this.samples = []
  }
}

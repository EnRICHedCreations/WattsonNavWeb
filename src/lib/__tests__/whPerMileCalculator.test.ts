import { describe, it, expect } from 'vitest'
import { WhPerMileCalculator, METERS_PER_MILE } from '../domain/whPerMileCalculator'

describe('WhPerMileCalculator', () => {
  it('single sample returns null - not enough data for a rate', () => {
    const calc = new WhPerMileCalculator()
    expect(calc.addSample(0, 0, 500)).toBeNull()
  })

  it('constant power over exactly one mile at constant speed computes correctly', () => {
    // 500W constant, 10 mph constant -> one mile takes 6 minutes (0.1h).
    // Energy = 500W * 0.1h = 50Wh -> 50 Wh/mile.
    const calc = new WhPerMileCalculator()
    const metersPerMinuteAt10Mph = METERS_PER_MILE / 6

    calc.addSample(0, 0, 500)
    const result = calc.addSample(6 * 60_000, 6 * metersPerMinuteAt10Mph, 500)

    expect(result).toBeCloseTo(50, 1)
  })

  it('window trims old samples once distance exceeds the window', () => {
    const calc = new WhPerMileCalculator()
    const metersPerMinuteAt10Mph = METERS_PER_MILE / 6

    let result: number | null = null
    for (let minute = 0; minute <= 18; minute++) {
      result = calc.addSample(minute * 60_000, minute * metersPerMinuteAt10Mph, 500)
    }

    expect(result).toBeCloseTo(50, 0)
  })

  it('higher power in the recent window raises the rate even with a low-power history', () => {
    const calc = new WhPerMileCalculator()
    const metersPerMinuteAt10Mph = METERS_PER_MILE / 6

    for (let minute = 0; minute <= 6; minute++) {
      calc.addSample(minute * 60_000, minute * metersPerMinuteAt10Mph, 100)
    }
    let result: number | null = null
    for (let minute = 7; minute <= 13; minute++) {
      result = calc.addSample(minute * 60_000, minute * metersPerMinuteAt10Mph, 1000)
    }

    expect(result).toBeCloseTo(100, 0)
  })

  it('reset clears accumulated samples', () => {
    const calc = new WhPerMileCalculator()
    calc.addSample(0, 0, 500)
    calc.addSample(60_000, 100, 500)
    calc.reset()
    expect(calc.addSample(0, 0, 500)).toBeNull()
  })
})

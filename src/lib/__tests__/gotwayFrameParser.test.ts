import { describe, it, expect } from 'vitest'
import { GotwayFrameParser } from '../wheel/gotwayFrameParser'

function hex(s: string): Uint8Array {
  const clean = s.replace(/\s/g, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

describe('GotwayFrameParser', () => {
  it('no telemetry before a full frame arrives', () => {
    const parser = new GotwayFrameParser()
    const result = parser.feed(hex('55AA19A0000C00000000032AF8150001FFF80018'))
    expect(result).toBeNull()
  })

  it('decodes frame type 0x00 (live data) matching WheelLog verified vector', () => {
    const parser = new GotwayFrameParser()
    parser.feed(hex('55AA19A0000C00000000032AF8150001FFF80018'))
    const telemetry = parser.feed(hex('5A5A5A5A'))

    expect(telemetry).not.toBeNull()
    expect(telemetry!.voltageVolts).toBeCloseTo(65.6, 2)
    expect(telemetry!.voltageFromBms).toBe(false)
    expect(telemetry!.currentAmps).toBeCloseTo(8.1, 2)
    expect(telemetry!.currentIsPackCurrent).toBe(false)
    expect(telemetry!.temperatureCelsius).toBeCloseTo(30.568, 2)
    expect(telemetry!.speedMph).toBeCloseTo(0.43, 2)
  })

  it('decodes frame type 0x04 (total distance) matching WheelLog verified vector', () => {
    const parser = new GotwayFrameParser()
    parser.feed(hex('55AA000026E324001C19001E0001000700080418'))
    const telemetry = parser.feed(hex('5A5A5A5A'))

    expect(telemetry).not.toBeNull()
    expect(telemetry!.totalDistanceMeters).toBe(9955)
  })

  it('pack voltage calibration scales frame 0x00 voltage correctly', () => {
    const parser = new GotwayFrameParser({ cellCount: 32 })
    parser.feed(hex('55AA19A0000C00000000032AF8150001FFF80018'))
    const telemetry = parser.feed(hex('5A5A5A5A'))

    expect(telemetry!.voltageVolts).toBeCloseTo(131.2, 2)
  })

  it('frame 0x07 battery current takes priority over frame 0x00 phase current', () => {
    const parser = new GotwayFrameParser()
    parser.feed(hex('55AA19A0000C00000000032AF8150001FFF80018'))
    parser.feed(hex('5A5A5A5A'))

    parser.feed(hex('55AA01F400000000000000000000000000000718'))
    const telemetry = parser.feed(hex('5A5A5A5A'))

    expect(telemetry!.currentIsPackCurrent).toBe(true)
    expect(telemetry!.currentAmps).toBeCloseTo(-5.0, 2)
    expect(telemetry!.voltageVolts).toBeCloseTo(65.6, 2)

    parser.feed(hex('55AA19A0000C00000000032AF8150001FFF80018'))
    const afterFrameA = parser.feed(hex('5A5A5A5A'))
    expect(afterFrameA!.currentAmps).toBeCloseTo(-5.0, 2)
  })

  it('frame 0x01 BMS voltage takes priority over frame 0x00 voltage', () => {
    const parser = new GotwayFrameParser()
    parser.feed(hex('55AA000000000290000000000000000000000118'))
    parser.feed(hex('5A5A5A5A'))

    parser.feed(hex('55AA19A0000C00000000032AF8150001FFF80018'))
    const telemetry = parser.feed(hex('5A5A5A5A'))

    expect(telemetry!.voltageFromBms).toBe(true)
    expect(telemetry!.voltageVolts).toBeCloseTo(65.6, 2)
  })
})

/**
 * Gotway/Begode BLE protocol decoder — TypeScript port of the Android app's
 * GotwayFrameParser.kt, which was itself verified byte-for-byte against
 * WheelLog's actual decoder source and real test vectors from WheelLog's own
 * test suite (see that file's header comment and NOTICE.md in the
 * wattson-wheel module for the full attribution and verification story).
 * Every formula below is a direct, unmodified port of already-verified
 * logic — nothing here is a fresh guess at the protocol.
 *
 * Scope matches the Android version: frame types 0x00 (live data), 0x01
 * (BMS voltage/current), 0x04 (total distance), 0x07 (real battery
 * current). Frame types 0x02/0x03 (per-cell BMS) and 0xFF (PID tuning) are
 * not decoded — not needed here either.
 */

export interface WheelTelemetry {
  voltageVolts: number | null
  voltageFromBms: boolean
  currentAmps: number | null
  currentIsPackCurrent: boolean
  speedMph: number | null // see MainActivity.kt's note: this value is what the
  // wheel's own display shows as mph, despite the raw protocol nominally
  // being a km/h-flavored field — matches the Android app's own labeling.
  totalDistanceMeters: number | null
  temperatureCelsius: number | null
  model: string | null
  firmwareVersion: string | null
  lastUpdatedAtMillis: number
}

export interface PackVoltageCalibration {
  cellCount: number
  manualScaleFactorOverride?: number
}

export function scaleFactor(calibration: PackVoltageCalibration): number {
  return calibration.manualScaleFactorOverride ?? calibration.cellCount / 16
}

function toActualVolts(rawHundredthsVolts: number, calibration: PackVoltageCalibration): number {
  return (rawHundredthsVolts * scaleFactor(calibration)) / 100
}

function shortBE(bytes: Uint8Array, offset: number): number {
  if (bytes.length < offset + 2) return 0
  return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff)
}

function signedShortBE(bytes: Uint8Array, offset: number): number {
  const val = shortBE(bytes, offset)
  return val >= 0x8000 ? val - 0x10000 : val
}

function int32BE(bytes: Uint8Array, offset: number): number {
  if (bytes.length < offset + 4) return 0
  return (
    ((bytes[offset] & 0xff) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff)
  ) >>> 0
}

/** Byte-stream unpacker — same 24-byte-frame state machine as the Kotlin
 * FrameUnpacker inner class: 55 AA header, 18 data bytes, frame-type byte,
 * fixed 0x18 byte, 5A 5A 5A 5A footer. No checksum in this protocol. */
class FrameUnpacker {
  private collecting = false
  private previousByte = -1
  private buffer: number[] = []
  private completedFrame: Uint8Array | null = null

  addByte(b: number): boolean {
    const c = b & 0xff
    if (this.collecting) {
      this.buffer.push(c)
      const size = this.buffer.length
      if (size >= 21 && size <= 24 && c !== 0x5a) {
        this.collecting = false
        this.previousByte = c
        return false
      }
      if (size === 24) {
        this.completedFrame = Uint8Array.from(this.buffer)
        this.collecting = false
        return true
      }
      this.previousByte = c
    } else {
      if (c === 0xaa && this.previousByte === 0x55) {
        this.buffer = [0x55, 0xaa]
        this.collecting = true
      }
      this.previousByte = c
    }
    return false
  }

  get frame(): Uint8Array {
    return this.completedFrame ?? new Uint8Array(0)
  }
}

export class GotwayFrameParser {
  private readonly calibration: PackVoltageCalibration
  private readonly unpacker = new FrameUnpacker()

  private voltageVolts: number | null = null
  private voltageFromBms = false
  private currentAmps: number | null = null
  private currentIsPackCurrent = false
  private speedMph: number | null = null
  private totalDistanceMeters: number | null = null
  private temperatureCelsius: number | null = null
  private model: string | null = null
  private firmwareVersion: string | null = null

  constructor(calibration: PackVoltageCalibration = { cellCount: 16 }) {
    this.calibration = calibration
  }

  /** Feed raw bytes as they arrive from the BLE notify characteristic.
   * Returns the current merged telemetry snapshot if this call completed
   * at least one full frame, null otherwise. */
  feed(data: Uint8Array, nowMillis: number = Date.now()): WheelTelemetry | null {
    this.maybeParseNameAnnouncement(data)

    let updated = false
    for (const byte of data) {
      if (this.unpacker.addByte(byte) && this.decodeFrame(this.unpacker.frame)) {
        updated = true
      }
    }

    if (!updated) return null
    return {
      voltageVolts: this.voltageVolts,
      voltageFromBms: this.voltageFromBms,
      currentAmps: this.currentAmps,
      currentIsPackCurrent: this.currentIsPackCurrent,
      speedMph: this.speedMph,
      totalDistanceMeters: this.totalDistanceMeters,
      temperatureCelsius: this.temperatureCelsius,
      model: this.model,
      firmwareVersion: this.firmwareVersion,
      lastUpdatedAtMillis: nowMillis,
    }
  }

  private maybeParseNameAnnouncement(data: Uint8Array): void {
    if (this.model !== null && this.firmwareVersion !== null) return
    let text: string
    try {
      text = new TextDecoder().decode(data).trim()
    } catch {
      return
    }
    if (text.startsWith('NAME')) this.model = text.substring(5).trim()
    else if (text.startsWith('GW')) this.firmwareVersion = text.substring(2).trim()
  }

  private decodeFrame(buff: Uint8Array): boolean {
    if (buff.length < 20) return false
    switch (buff[18] & 0xff) {
      case 0x00:
        return this.decodeLiveDataFrame(buff)
      case 0x01:
        return this.decodeBmsFrame(buff)
      case 0x04:
        return this.decodeDistanceAndAlertsFrame(buff)
      case 0x07:
        return this.decodeBatteryCurrentFrame(buff)
      default:
        return false
    }
  }

  private decodeLiveDataFrame(buff: Uint8Array): boolean {
    const rawVoltage = shortBE(buff, 2)
    this.speedMph = Math.round(signedShortBE(buff, 4) * 3.6) / 100
    const phaseCurrentRaw = signedShortBE(buff, 10)
    this.temperatureCelsius = signedShortBE(buff, 12) / 340 + 36.53

    if (!this.voltageFromBms) {
      this.voltageVolts = toActualVolts(rawVoltage, this.calibration)
    }
    if (!this.currentIsPackCurrent) {
      this.currentAmps = phaseCurrentRaw / 100
    }
    return true
  }

  private decodeBmsFrame(buff: Uint8Array): boolean {
    const batVoltageRaw = shortBE(buff, 6)
    this.voltageVolts = toActualVolts(batVoltageRaw * 10, this.calibration)
    this.voltageFromBms = true
    return true
  }

  private decodeDistanceAndAlertsFrame(buff: Uint8Array): boolean {
    this.totalDistanceMeters = int32BE(buff, 2)
    return true
  }

  private decodeBatteryCurrentFrame(buff: Uint8Array): boolean {
    const batteryCurrentRaw = signedShortBE(buff, 2)
    this.currentAmps = -1 * (batteryCurrentRaw / 100)
    this.currentIsPackCurrent = true
    return true
  }
}

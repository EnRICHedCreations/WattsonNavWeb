import { GotwayFrameParser, type WheelTelemetry, type PackVoltageCalibration } from './gotwayFrameParser'

/** Confirmed against WheelLog's Constants.kt — same UUIDs as the Android
 * app's WheelBleClient.kt. */
const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb'

export type WheelConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'FAILED'

/**
 * Connects to a Gotway/Begode wheel over Web Bluetooth. This is NOT
 * equivalent to the Android app's scan-and-list experience — Web Bluetooth
 * has no API for a custom scan list at all. `requestDevice()` must be
 * called directly from a user gesture (a click), and it always shows the
 * browser's own native device picker, not anything this code controls.
 * Using `acceptAllDevices: true` rather than filtering by service UUID for
 * the same reason as the Android scanner: many of these BLE-to-serial
 * modules don't reliably advertise service UUIDs in the advertisement
 * packet, so a filtered request risks finding nothing even with the wheel
 * on and in range.
 *
 * Platform reality, not a bug: Web Bluetooth does not exist on iOS Safari
 * at all (Apple has never implemented it, the same story as PWA install
 * prompts) — this only ever works on Chrome (desktop or Android).
 *
 * Like the Android BLE client, this has not been run against real
 * hardware. The frame parser underneath it is verified; this connection
 * layer is standard-pattern but unproven.
 */
export class WheelBleClient {
  private parser: GotwayFrameParser
  private device: BluetoothDevice | null = null
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null

  private state: WheelConnectionState = 'DISCONNECTED'
  private telemetry: WheelTelemetry | null = null
  private stateListeners = new Set<(state: WheelConnectionState) => void>()
  private telemetryListeners = new Set<(telemetry: WheelTelemetry) => void>()

  constructor(calibration: PackVoltageCalibration = { cellCount: 16 }) {
    this.parser = new GotwayFrameParser(calibration)
  }

  /** Swaps in a fresh parser with new calibration — used when the rider
   * updates their pack cell count in settings. Deliberately does NOT
   * require a new WheelBleClient instance: the state/telemetry listeners
   * registered on this client would otherwise need to be re-attached. */
  updateCalibration(calibration: PackVoltageCalibration): void {
    this.parser = new GotwayFrameParser(calibration)
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator
  }

  onStateChange(listener: (state: WheelConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onTelemetry(listener: (telemetry: WheelTelemetry) => void): () => void {
    this.telemetryListeners.add(listener)
    return () => this.telemetryListeners.delete(listener)
  }

  private setState(state: WheelConnectionState): void {
    this.state = state
    this.stateListeners.forEach((l) => l(state))
  }

  /** Must be called directly from a click handler — Web Bluetooth rejects
   * requestDevice() calls not triggered by a user gesture. */
  async connect(): Promise<void> {
    if (!WheelBleClient.isSupported()) {
      this.setState('FAILED')
      throw new Error('Web Bluetooth is not available in this browser (Chrome only, no iOS Safari).')
    }

    this.setState('CONNECTING')
    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      })
      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect())

      const server = await this.device.gatt?.connect()
      if (!server) throw new Error('Could not connect to GATT server')

      const service = await server.getPrimaryService(SERVICE_UUID)
      this.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID)

      await this.characteristic.startNotifications()
      this.characteristic.addEventListener('characteristicvaluechanged', this.handleNotification)

      this.setState('CONNECTED')
    } catch (error) {
      console.error('WheelBleClient.connect failed:', error)
      this.setState('FAILED')
      throw error
    }
  }

  disconnect(): void {
    this.device?.gatt?.disconnect()
  }

  private handleDisconnect = (): void => {
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.handleNotification)
    this.characteristic = null
    this.device = null
    this.setState('DISCONNECTED')
  }

  private handleNotification = (event: Event): void => {
    const target = event.target as BluetoothRemoteGATTCharacteristic
    const value = target.value
    if (!value) return
    const bytes = new Uint8Array(value.buffer)
    const updated = this.parser.feed(bytes)
    if (updated) {
      this.telemetry = updated
      this.telemetryListeners.forEach((l) => l(updated))
    }
  }

  getState(): WheelConnectionState {
    return this.state
  }

  getTelemetry(): WheelTelemetry | null {
    return this.telemetry
  }
}

/**
 * BLE Advertiser (optional)
 *
 * Purpose: emit a short-lived “Navis is nearby” signal during onboarding so
 * phones can confirm proximity via Web Bluetooth (PWA) or other scanners.
 *
 * This is intentionally optional: if the native BLE module is unavailable,
 * the daemon must still start and onboarding should continue via QR/mDNS.
 */

import { logger } from '@navisai/logging'

const DEFAULTS = {
  name: 'Navis',
  serviceUuid: '9f3a2b40-7f6b-4f13-8f1e-0b7a49b4a0a1',
  advertiseMs: 10 * 60 * 1000, // 10 minutes
}

export class BleAdvertiser {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options }
    this.bleno = null
    this.started = false
    this.stopTimer = null
  }

  async isAvailable() {
    try {
      await import('@abandonware/bleno')
      return true
    } catch {
      return false
    }
  }

  async start() {
    if (this.started) return true

    let blenoModule
    try {
      blenoModule = await import('@abandonware/bleno')
    } catch (error) {
      logger.info('BLE advertiser unavailable (module not installed)', {
        module: '@abandonware/bleno',
        error: error?.message,
      })
      return false
    }

    const bleno = blenoModule?.default || blenoModule
    this.bleno = bleno

    const { name, serviceUuid, advertiseMs } = this.options

    const startAdvertising = () =>
      new Promise((resolve, reject) => {
        bleno.startAdvertising(name, [serviceUuid], (err) => {
          if (err) return reject(err)
          resolve(true)
        })
      })

    const stopAdvertising = () =>
      new Promise((resolve) => {
        try {
          bleno.stopAdvertising(() => resolve(true))
        } catch {
          resolve(true)
        }
      })

    await new Promise((resolve) => bleno.once('stateChange', resolve))
    if (bleno.state !== 'poweredOn') {
      logger.info('BLE advertiser not started (Bluetooth not powered on)', {
        state: bleno.state,
      })
      return false
    }

    try {
      await startAdvertising()
      this.started = true

      logger.info('BLE advertiser started', { name, serviceUuid, ttlMs: advertiseMs })

      if (advertiseMs > 0) {
        this.stopTimer = setTimeout(() => {
          this.stop().catch(() => {})
        }, advertiseMs)
        this.stopTimer.unref?.()
      }

      return true
    } catch (error) {
      await stopAdvertising()
      logger.warn('BLE advertiser failed to start', { error: error?.message })
      this.started = false
      return false
    }
  }

  async stop() {
    if (!this.bleno || !this.started) return
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = null

    await new Promise((resolve) => {
      try {
        this.bleno.stopAdvertising(() => resolve(true))
      } catch {
        resolve(true)
      }
    })

    logger.info('BLE advertiser stopped')
    this.started = false
  }
}


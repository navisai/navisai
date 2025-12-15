/**
 * Pairing Service
 * Handles device pairing via mDNS, QR codes, and tokens
 */

import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'

export class PairingService {
  constructor() {
    this.devices = new Map()
    this.pairingTokens = new Map()
  }

  async initialize() {
    console.log('📱 Pairing service initialized')
  }

  async generateQR() {
    const token = this.generateToken()
    const pairingData = {
      id: token,
      name: 'NavisAI Pairing',
      type: 'qr',
      expires: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
    }

    this.pairingTokens.set(token, {
      ...pairingData,
      createdAt: new Date().toISOString()
    })

    // Generate QR code image as data URL
    // Port configuration follows IPC_TRANSPORT.md default
    const qrData = JSON.stringify({
      type: 'navis-pairing',
      version: 1,
      host: 'navis.local',
      port: process.env.NAVIS_PORT || 47621, // Use default from IPC_TRANSPORT.md
      pairingToken: token
    })

    const qrImage = await QRCode.toDataURL(qrData, {
      width: 256,
      margin: 2,
      color: {
        dark: '#1e3a8a',
        light: '#ffffff'
      }
    })

    return { qrImage }
  }

  async generatePairingData() {
    const token = this.generateToken()
    const pairingData = {
      id: token,
      name: 'NavisAI Pairing',
      type: 'navis-pairing',
      version: 1,
      host: 'navis.local',
      // Use default port from IPC_TRANSPORT.md:47621 (configurable)
      port: process.env.NAVIS_PORT || 47621,
      expires: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
    }

    this.pairingTokens.set(token, {
      ...pairingData,
      createdAt: new Date().toISOString()
    })

    return pairingData
  }

  async hasPairedDevices() {
    return Array.from(this.devices.values()).some(d => !d.isRevoked)
  }

  async listDevices() {
    return {
      devices: Array.from(this.devices.values()).map(device => ({
        id: device.id,
        name: device.name,
        type: device.type,
        pairedAt: device.pairedAt,
        lastSeen: device.lastSeen,
        isRevoked: device.isRevoked
      }))
    }
  }

  async revokeDevice(id) {
    const device = this.devices.get(id)
    if (!device) {
      throw new Error('Device not found')
    }

    device.isRevoked = true
    device.revokedAt = new Date().toISOString()
    this.devices.set(id, device)

    return { success: true, device }
  }

  async pairDevice(token, deviceInfo) {
    const pairingData = this.pairingTokens.get(token)
    if (!pairingData) {
      throw new Error('Invalid or expired pairing token')
    }

    if (new Date(pairingData.expires) < new Date()) {
      this.pairingTokens.delete(token)
      throw new Error('Pairing token expired')
    }

    const device = {
      id: this.generateId(),
      name: deviceInfo.name || 'Unknown Device',
      type: deviceInfo.type || 'mobile',
      token,
      pairedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      isRevoked: false,
      ...deviceInfo
    }

    this.devices.set(device.id, device)
    this.pairingTokens.delete(token)

    return device
  }

  async validateDevice(deviceId) {
    const device = this.devices.get(deviceId)
    if (!device || device.isRevoked) {
      throw new Error('Device not found or revoked')
    }

    device.lastSeen = new Date().toISOString()
    this.devices.set(deviceId, device)

    return device
  }

  generateToken() {
    return randomBytes(16).toString('hex').toUpperCase()
  }

  generateId() {
    return 'device_' + Math.random().toString(36).substr(2, 9)
  }
}

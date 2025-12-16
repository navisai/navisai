/**
 * Pairing Service
 * Handles device pairing via mDNS, QR codes, and tokens
 */

import { randomBytes, createHash } from 'node:crypto'
import QRCode from 'qrcode'

export class PairingService {
  constructor({ approvalService, dbManager, bleAdvertiser } = {}) {
    this.devices = new Map()
    this.pairingTokens = new Map()
    this.pendingApprovals = new Map()
    this.approvalService = approvalService || null
    this.dbManager = dbManager || null
    this.bleAdvertiser = bleAdvertiser || null
  }

  async initialize() {
    console.log('📱 Pairing service initialized')
  }

  setDependencies({ approvalService, dbManager, bleAdvertiser }) {
    if (approvalService) this.approvalService = approvalService
    if (dbManager) this.dbManager = dbManager
    if (bleAdvertiser) this.bleAdvertiser = bleAdvertiser
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
    const qrData = JSON.stringify({
      type: 'navis-pairing',
      version: 1,
      origin: 'https://navis.local',
      pairingToken: token,
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
      origin: 'https://navis.local',
      expires: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
    }

    this.pairingTokens.set(token, {
      ...pairingData,
      createdAt: new Date().toISOString()
    })

    return pairingData
  }

  async handleStart(request, reply) {
    const body = request.body || {}
    const pairingToken = body.pairingToken
    const clientName = body.clientName || body.name || 'Unknown Device'
    const clientDeviceInfo = body.clientDeviceInfo || {}

    if (!pairingToken || typeof pairingToken !== 'string') {
      reply.code(400)
      return { error: 'pairingToken is required' }
    }

    const pairingData = this.pairingTokens.get(pairingToken)
    if (!pairingData) {
      reply.code(401)
      return { error: 'Invalid or expired pairingToken' }
    }

    if (new Date(pairingData.expires) < new Date()) {
      this.pairingTokens.delete(pairingToken)
      reply.code(401)
      return { error: 'Invalid or expired pairingToken' }
    }

    if (!this.approvalService) {
      reply.code(503)
      return { error: 'Approval service not available' }
    }

    const approval = await this.approvalService.createApproval(
      'pairing',
      {
        pairingToken,
        clientName,
        clientDeviceInfo,
      },
      { projectId: null }
    )

    const waitForResolution = new Promise((resolve, reject) => {
      this.pendingApprovals.set(approval.id, { resolve, reject, pairingToken, clientName })
    })

    try {
      const result = await Promise.race([
        waitForResolution,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('PAIRING_TIMEOUT')), 2 * 60 * 1000)
        ),
      ])

      return result
    } catch (error) {
      this.pendingApprovals.delete(approval.id)
      if (error?.message === 'PAIRING_DENIED') {
        reply.code(403)
        return { error: 'Pairing denied' }
      }
      reply.code(error?.message === 'PAIRING_TIMEOUT' ? 408 : 500)
      return { error: 'Pairing request timed out or failed' }
    }
  }

  async handleRequest(request, reply) {
    return this.handleStart(request, reply)
  }

  async onApprovalResolved(approval) {
    const pending = this.pendingApprovals.get(approval.id)
    if (!pending) return
    this.pendingApprovals.delete(approval.id)

    const { resolve, reject, pairingToken, clientName } = pending

    if (approval.status === 'approved') {
      try {
        const device = await this.createTrustedDevice({ name: clientName })
        this.pairingTokens.delete(pairingToken)
        await this.bleAdvertiser?.stop?.()
        resolve({
          deviceId: device.id,
          deviceSecret: device.deviceSecret,
          deviceName: device.name,
          apiBaseUrl: 'https://navis.local',
        })
      } catch (error) {
        reject(error)
      }
      return
    }

    this.pairingTokens.delete(pairingToken)
    reject(new Error('PAIRING_DENIED'))
  }

  async createTrustedDevice({ name }) {
    if (!this.dbManager) {
      throw new Error('DB not available')
    }

    const deviceId = `device_${randomBytes(12).toString('hex')}`
    const rawSecret = randomBytes(32).toString('hex')
    const deviceSecret = createHash('sha256').update(rawSecret).digest('hex')
    const now = new Date().toISOString()

    await this.dbManager.execute(
      'INSERT INTO devices (id, name, secretHash, pairedAt, lastSeenAt, isRevoked) VALUES (?, ?, ?, ?, ?, 0)',
      [deviceId, name, deviceSecret, now, now]
    )

    return { id: deviceId, deviceSecret, name }
  }

  async hasPairedDevices() {
    if (!this.dbManager) return false
    const rows = await this.dbManager.query('SELECT id FROM devices WHERE isRevoked = 0 LIMIT 1')
    return rows.length > 0
  }

  async listDevices() {
    if (!this.dbManager) return { devices: [] }
    const devices = await this.dbManager.query(
      'SELECT id, name, publicKey, pairedAt, lastSeenAt, isRevoked FROM devices ORDER BY lastSeenAt DESC'
    )
    return { devices }
  }

  async revokeDevice(id) {
    if (!this.dbManager) {
      throw new Error('DB not available')
    }

    await this.dbManager.execute('UPDATE devices SET isRevoked = 1 WHERE id = ?', [id])
    const rows = await this.dbManager.query(
      'SELECT id, name, publicKey, pairedAt, lastSeenAt, isRevoked FROM devices WHERE id = ? LIMIT 1',
      [id]
    )

    if (!rows[0]) {
      throw new Error('Device not found')
    }

    return { success: true, device: rows[0] }
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

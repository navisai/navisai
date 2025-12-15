/**
 * WebSocket Manager
 * Handles real-time communication for live updates
 */

import { WebSocketServer } from 'ws'
import {
  createWebSocketCanonicalString,
  verifySignature,
  checkReplay,
  isTimestampValid,
} from './auth/utils.js'

export class WebSocketManager {
  constructor(fastify, dbManager) {
    this.fastify = fastify
    this.dbManager = dbManager
    this.wss = null
    this.clients = new Map()
  }

  async initialize() {
    const server = this.fastify.server

    this.wss = new WebSocketServer({
      server,
      path: '/ws'
    })

    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request).catch(error => {
        console.error('WebSocket auth error:', error)
        ws.close(4401, 'Unauthorized')
      })
    })

    console.log('🔌 WebSocket manager initialized')
  }

  async handleConnection(ws, request) {
    const authParams = this.extractAuthParams(request.url)
    if (!authParams) {
      ws.close(4401, 'Missing authentication parameters')
      return
    }

    const { deviceId, timestamp, signature } = authParams
    if (!isTimestampValid(timestamp)) {
      ws.close(4401, 'Invalid timestamp')
      return
    }

    const deviceRows = await this.dbManager.query(
      'SELECT id, secretHash, isRevoked FROM devices WHERE id = ?',
      [deviceId]
    )

    if (!deviceRows.length || deviceRows[0].isRevoked) {
      ws.close(4401, 'Device unauthorized')
      return
    }

    const canonical = createWebSocketCanonicalString('/ws', timestamp)
    if (!verifySignature(canonical, signature, deviceRows[0].secretHash)) {
      ws.close(4401, 'Invalid signature')
      return
    }

    const requestTime = Date.parse(timestamp)
    if (!checkReplay(deviceId, signature, requestTime)) {
      ws.close(4101, 'Replay detected')
      return
    }

    const clientId = this.generateClientId()
    const client = {
      id: clientId,
      ws,
      deviceId,
      ip: request.socket.remoteAddress,
      userAgent: request.headers['user-agent'],
      connectedAt: new Date().toISOString(),
      authenticated: true,
      channels: new Set(),
    }

    this.clients.set(clientId, client)

    ws.on('message', (data) => {
      this.handleMessage(clientId, data)
    })

    ws.on('close', () => {
      this.clients.delete(clientId)
    })

    ws.on('error', (error) => {
      console.error('WebSocket error:', error)
      this.clients.delete(clientId)
    })

    this.send(clientId, {
      type: 'connected',
      clientId,
      timestamp: new Date().toISOString()
    })
  }

  handleMessage(clientId, data) {
    try {
      const client = this.clients.get(clientId)
      if (!client || !client.authenticated) {
        return
      }

      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'ping':
          this.send(clientId, { type: 'pong', timestamp: new Date().toISOString() })
          break

        case 'subscribe':
          this.handleSubscription(clientId, message.channels || [])
          break

        default:
          console.log('Unknown message type:', message.type)
      }
    } catch (error) {
      console.error('Error handling message:', error)
    }
  }

  handleSubscription(clientId, channels) {
    const client = this.clients.get(clientId)
    if (client) {
      client.channels = new Set(channels)
      this.send(clientId, {
        type: 'subscribed',
        channels,
        timestamp: new Date().toISOString()
      })
    }
  }

  send(clientId, data) {
    const client = this.clients.get(clientId)
    if (client && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(data))
    }
  }

  broadcast(data, channel = null) {
    const message = JSON.stringify({
      ...data,
      timestamp: new Date().toISOString()
    })

    for (const client of this.clients.values()) {
      if (!client.authenticated || client.ws.readyState !== 1) {
        continue
      }
      if (!channel || (client.channels && client.channels.has(channel))) {
        client.ws.send(message)
      }
    }
  }

  close() {
    if (this.wss) {
      this.wss.close()
      this.clients.clear()
    }
  }

  extractAuthParams(rawUrl) {
    if (!rawUrl) return null
    try {
      const url = new URL(rawUrl, 'https://navis.local')
      const deviceId = url.searchParams.get('deviceId')
      const timestamp = url.searchParams.get('timestamp')
      const signature = url.searchParams.get('signature')
      if (!deviceId || !timestamp || !signature) {
        return null
      }
      return { deviceId, timestamp, signature }
    } catch {
      return null
    }
  }

  generateClientId() {
    return 'ws_' + Math.random().toString(36).substr(2, 9)
  }
}

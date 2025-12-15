/**
 * Navis Daemon WebSocket Manager
 * Handles WebSocket connections, authentication, and message routing
 */

import { logger } from '@navisai/logging'
import { WebSocketEvents } from './events.js'

export class WebSocketManager {
  constructor() {
    this.wss = null
    this.events = null
    this.authenticatedClients = new Map()
    this.clientSubscriptions = new Map()
  }

  initialize(wss) {
    this.wss = wss
    this.events = new WebSocketEvents(wss)

    // Set up connection handling
    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request)
    })

    logger.info('WebSocket manager initialized')
    return this.events
  }

  handleConnection(ws, request) {
    const clientId = this.generateClientId()
    const clientInfo = {
      id: clientId,
      ws,
      ip: request.socket.remoteAddress,
      userAgent: request.headers['user-agent'],
      connectedAt: new Date().toISOString(),
      isAuthenticated: false,
      subscriptions: new Set()
    }

    // Store client info
    this.authenticatedClients.set(clientId, clientInfo)

    logger.info('WebSocket client connected', {
      clientId,
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent
    })

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      timestamp: new Date().toISOString()
    }))

    // Set up message handling
    ws.on('message', (message) => {
      this.handleMessage(clientId, message)
    })

    // Handle disconnection
    ws.on('close', () => {
      this.handleDisconnection(clientId)
    })

    // Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket client error', {
        clientId,
        error: error.message
      })
    })

    // Set up ping/pong for connection health
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
  }

  handleMessage(clientId, message) {
    const client = this.authenticatedClients.get(clientId)
    if (!client) return

    try {
      const data = JSON.parse(message.toString())
      const { type, ...payload } = data

      logger.debug('WebSocket message received', {
        clientId,
        type,
        payloadKeys: Object.keys(payload)
      })

      switch (type) {
        case 'ping':
          this.handlePing(clientId)
          break

        case 'authenticate':
          this.handleAuthentication(clientId, payload)
          break

        case 'subscribe':
          this.handleSubscription(clientId, payload)
          break

        case 'unsubscribe':
          this.handleUnsubscription(clientId, payload)
          break

        case 'approve':
          this.handleApproval(clientId, payload)
          break

        case 'deny':
          this.handleDenial(clientId, payload)
          break

        case 'scan':
          this.handleScanRequest(clientId, payload)
          break

        default:
          logger.warn('Unknown WebSocket message type', {
            clientId,
            type
          })
          this.sendError(clientId, 'Unknown message type', type)
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message', {
        clientId,
        error: error.message,
        message: message.toString().slice(0, 200)
      })
      this.sendError(clientId, 'Invalid message format')
    }
  }

  handlePing(clientId) {
    const client = this.authenticatedClients.get(clientId)
    if (client && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString()
      }))
    }
  }

  async handleAuthentication(clientId, payload) {
    const { token, deviceId } = payload
    const client = this.authenticatedClients.get(clientId)

    // TODO: Implement proper authentication with device registry
    // For now, accept any token and mark as authenticated
    client.isAuthenticated = true
    client.deviceId = deviceId || 'unknown'

    logger.info('WebSocket client authenticated', {
      clientId,
      deviceId: client.deviceId
    })

    client.ws.send(JSON.stringify({
      type: 'authenticated',
      timestamp: new Date().toISOString()
    }))

    // Send initial data
    this.events.broadcast('client_authenticated', {
      clientId,
      deviceId: client.deviceId
    })
  }

  handleSubscription(clientId, payload) {
    const client = this.authenticatedClients.get(clientId)
    if (!client.isAuthenticated) {
      this.sendError(clientId, 'Authentication required', 'subscribe')
      return
    }

    const { events } = payload
    if (Array.isArray(events)) {
      events.forEach(event => {
        client.subscriptions.add(event)
      })
    }

    logger.debug('Client subscribed to events', {
      clientId,
      events
    })

    client.ws.send(JSON.stringify({
      type: 'subscribed',
      events,
      timestamp: new Date().toISOString()
    }))
  }

  handleUnsubscription(clientId, payload) {
    const client = this.authenticatedClients.get(clientId)
    const { events } = payload

    if (Array.isArray(events)) {
      events.forEach(event => {
        client.subscriptions.delete(event)
      })
    }

    logger.debug('Client unsubscribed from events', {
      clientId,
      events
    })
  }

  async handleApproval(clientId, payload) {
    const client = this.authenticatedClients.get(clientId)
    if (!client.isAuthenticated) {
      this.sendError(clientId, 'Authentication required', 'approve')
      return
    }

    const { approvalId } = payload

    try {
      // This would integrate with the approvals repository
      logger.info('Approval requested via WebSocket', {
        clientId,
        approvalId
      })

      // TODO: Implement actual approval logic
      this.events.broadcast('approval_requested', {
        approvalId,
        approvedBy: clientId,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Failed to process approval', {
        clientId,
        approvalId,
        error: error.message
      })
      this.sendError(clientId, 'Failed to process approval', 'approve')
    }
  }

  async handleDenial(clientId, payload) {
    const client = this.authenticatedClients.get(clientId)
    if (!client.isAuthenticated) {
      this.sendError(clientId, 'Authentication required', 'deny')
      return
    }

    const { approvalId } = payload

    try {
      logger.info('Denial requested via WebSocket', {
        clientId,
        approvalId
      })

      // TODO: Implement actual denial logic
      this.events.broadcast('approval_denied', {
        approvalId,
        deniedBy: clientId,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Failed to process denial', {
        clientId,
        approvalId,
        error: error.message
      })
      this.sendError(clientId, 'Failed to process denial', 'deny')
    }
  }

  handleScanRequest(clientId, payload) {
    const client = this.authenticatedClients.get(clientId)
    if (!client.isAuthenticated) {
      this.sendError(clientId, 'Authentication required', 'scan')
      return
    }

    const { path } = payload

    logger.info('Scan requested via WebSocket', {
      clientId,
      path
    })

    // TODO: Implement actual scan trigger
    this.events.broadcast('scan_requested', {
      requestedBy: clientId,
      path,
      timestamp: new Date().toISOString()
    })
  }

  handleDisconnection(clientId) {
    const client = this.authenticatedClients.get(clientId)
    if (client) {
      logger.info('WebSocket client disconnected', {
        clientId,
        connectedDuration: Date.now() - new Date(client.connectedAt).getTime()
      })

      this.authenticatedClients.delete(clientId)
    }
  }

  sendError(clientId, message, type = null) {
    const client = this.authenticatedClients.get(clientId)
    if (client && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'error',
        message,
        errorType: type,
        timestamp: new Date().toISOString()
      }))
    }
  }

  generateClientId() {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Health monitoring
  startHealthMonitoring(intervalMs = 30000) {
    if (!this.wss) return

    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          ws.terminate()
          return
        }

        ws.isAlive = false
        ws.ping()
      })
    }, intervalMs)
  }

  getStats() {
    return {
      connectedClients: this.authenticatedClients.size,
      authenticatedClients: Array.from(this.authenticatedClients.values())
        .filter(c => c.isAuthenticated).length,
      totalSubscriptions: Array.from(this.authenticatedClients.values())
        .reduce((total, client) => total + client.subscriptions.size, 0)
    }
  }
}

// Export singleton instance
export const wsManager = new WebSocketManager()
export default wsManager

/**
 * WebSocket Manager
 * Handles real-time communication for live updates
 */

import { WebSocketServer } from 'ws'

export class WebSocketManager {
  constructor(fastify) {
    this.fastify = fastify
    this.wss = null
    this.clients = new Map()
  }

  async initialize() {
    // Get the underlying HTTP server
    const server = this.fastify.server

    // Create WebSocket server
    this.wss = new WebSocketServer({
      server,
      path: '/ws'
    })

    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request)
    })

    console.log('🔌 WebSocket manager initialized')
  }

  handleConnection(ws, request) {
    const clientId = this.generateClientId()

    const client = {
      id: clientId,
      ws,
      ip: request.socket.remoteAddress,
      userAgent: request.headers['user-agent'],
      connectedAt: new Date().toISOString(),
      authenticated: false
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

    // Send initial message
    this.send(clientId, {
      type: 'connected',
      clientId,
      timestamp: new Date().toISOString()
    })
  }

  handleMessage(clientId, data) {
    try {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'ping':
          this.send(clientId, { type: 'pong', timestamp: new Date().toISOString() })
          break

        case 'subscribe':
          this.handleSubscription(clientId, message.channels || [])
          break

        case 'auth':
          this.handleAuth(clientId, message.token)
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

  handleAuth(clientId, token) {
    // TODO: Implement proper authentication
    const client = this.clients.get(clientId)
    if (client) {
      client.authenticated = true
      this.send(clientId, {
        type: 'authenticated',
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
      if (client.ws.readyState === 1) {
        // Send to all clients or only those subscribed to the channel
        if (!channel || (client.channels && client.channels.has(channel))) {
          client.ws.send(message)
        }
      }
    }
  }

  close() {
    if (this.wss) {
      this.wss.close()
      this.clients.clear()
    }
  }

  generateClientId() {
    return 'ws_' + Math.random().toString(36).substr(2, 9)
  }
}

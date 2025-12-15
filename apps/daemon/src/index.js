import Fastify from 'fastify'
import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import dbManager from '../../../packages/db/index.js'
import { projectsRepo, devicesRepo, approvalsRepo } from '../../../packages/db/repositories.js'

class NavisDaemon {
  constructor() {
    this.server = null
    this.wss = null
    this.port = 3415 // Default port, will be configurable later
    this.isRunning = false
  }

  async start() {
    try {
      console.log('Starting Navis daemon...')

      // Initialize database
      await dbManager.initialize()
      console.log('Database initialized')

      // Create HTTP server
      this.server = Fastify({
        logger: {
          level: 'info',
          transport: {
            target: 'pino-pretty',
          },
        },
      })

      // Register routes
      await this.registerRoutes()

      // Create WebSocket server
      const httpServer = createServer()
      this.wss = new WebSocketServer({ server: httpServer })

      // Start the server
      await this.server.listen({ port: this.port, host: '127.0.0.1' })

      // Bind WebSocket to the same server
      httpServer.on('upgrade', (request, socket, head) => {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request)
        })
      })

      httpServer.listen(this.port, '127.0.0.1', () => {
        console.log(`🚀 Navis daemon running on http://127.0.0.1:${this.port}`)
        console.log(`📡 WebSocket server ready`)
      })

      this.isRunning = true

      // Handle WebSocket connections
      this.wss.on('connection', (ws, request) => {
        console.log('WebSocket client connected')

        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message.toString())
            this.handleWebSocketMessage(ws, data)
          } catch (error) {
            console.error('Invalid WebSocket message:', error)
          }
        })

        ws.on('close', () => {
          console.log('WebSocket client disconnected')
        })
      })

    } catch (error) {
      console.error('Failed to start daemon:', error)
      throw error
    }
  }

  async registerRoutes() {
    // Health check endpoint
    this.server.get('/status', async (request, reply) => {
      return {
        status: 'running',
        version: '0.1.0',
        database: dbManager.isAvailable(),
        port: this.port,
        timestamp: new Date().toISOString(),
      }
    })

    // Projects endpoints
    this.server.get('/api/projects', async (request, reply) => {
      if (!dbManager.isAvailable()) {
        return reply.code(503).send({ error: 'Database unavailable' })
      }

      try {
        const projectsList = await projectsRepo.findAll()
        return { projects: projectsList }
      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({ error: 'Failed to fetch projects' })
      }
    })

    this.server.get('/api/projects/:id', async (request, reply) => {
      if (!dbManager.isAvailable()) {
        return reply.code(503).send({ error: 'Database unavailable' })
      }

      try {
        const project = await projectsRepo.findById(request.params.id)
        if (!project) {
          return reply.code(404).send({ error: 'Project not found' })
        }
        return project
      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({ error: 'Failed to fetch project' })
      }
    })

    // Approvals endpoints
    this.server.get('/api/approvals/pending', async (request, reply) => {
      if (!dbManager.isAvailable()) {
        return reply.code(503).send({ error: 'Database unavailable' })
      }

      try {
        const pendingApprovals = await approvalsRepo.findPending()
        return { approvals: pendingApprovals }
      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({ error: 'Failed to fetch approvals' })
      }
    })

    this.server.post('/api/approvals/:id/:action', async (request, reply) => {
      if (!dbManager.isAvailable()) {
        return reply.code(503).send({ error: 'Database unavailable' })
      }

      const { id, action } = request.params
      if (action !== 'approve' && action !== 'deny') {
        return reply.code(400).send({ error: 'Invalid action' })
      }

      try {
        const approval = await approvalsRepo.resolve(id, action === 'approve' ? 'approved' : 'denied')

        // Broadcast to WebSocket clients
        this.broadcastWebSocket({
          type: 'approval_resolved',
          approval,
        })

        return approval
      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({ error: 'Failed to resolve approval' })
      }
    })

    // Devices endpoints
    this.server.get('/api/devices', async (request, reply) => {
      if (!dbManager.isAvailable()) {
        return reply.code(503).send({ error: 'Database unavailable' })
      }

      try {
        const devicesList = await devicesRepo.findAll()
        return { devices: devicesList }
      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({ error: 'Failed to fetch devices' })
      }
    })

    // Add CORS headers for PWA
    this.server.addHook('onRequest', (request, reply) => {
      reply.header('Access-Control-Allow-Origin', '*')
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

      if (request.method === 'OPTIONS') {
        reply.code(204).send()
      }
    })
  }

  handleWebSocketMessage(ws, data) {
    switch (data.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
        break
      case 'subscribe':
        // Handle subscription to events
        console.log('Client subscribed to updates')
        break
      default:
        console.log('Unknown WebSocket message type:', data.type)
    }
  }

  broadcastWebSocket(message) {
    if (!this.wss) return

    const messageStr = JSON.stringify(message)
    this.wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(messageStr)
      }
    })
  }

  async stop() {
    console.log('Stopping Navis daemon...')

    if (this.wss) {
      this.wss.close()
    }

    if (this.server) {
      await this.server.close()
    }

    await dbManager.close()

    this.isRunning = false
    console.log('Daemon stopped')
  }
}

// Create singleton instance
const daemon = new NavisDaemon()

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...')
  await daemon.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...')
  await daemon.stop()
  process.exit(0)
})

// Export for testing
export default daemon

// Run daemon if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  daemon.start().catch((error) => {
    console.error('Failed to start daemon:', error)
    process.exit(1)
  })
}

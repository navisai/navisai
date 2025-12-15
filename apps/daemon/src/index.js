import Fastify from 'fastify'
import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { homedir } from 'node:os'
import dbManager from '../../../packages/db/index.js'
import { projectsRepo, devicesRepo, approvalsRepo } from '../../../packages/db/repositories.js'
import { discoveryService } from '../../../packages/discovery/service.js'

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

    // Discovery endpoints
    this.server.post('/api/discovery/scan', async (request, reply) => {
      try {
        const { path, options = {} } = request.body

        if (!path) {
          return reply.code(400).send({ error: 'Path is required' })
        }

        // Default to user's home directory if no path provided
        const scanPath = path || homedir()

        // Discover projects
        const projects = await discoveryService.discoverProjects(scanPath, {
          depth: options.depth || 3,
          concurrency: options.concurrency || 5,
          ...options
        })

        // Store discovered projects in database
        if (dbManager.isAvailable()) {
          for (const project of projects) {
            try {
              await projectsRepo.upsert({
                id: project.id,
                path: project.path,
                name: project.name,
                updatedAt: new Date().toISOString()
              })

              // Store signals
              if (project.signals && project.signals.length > 0) {
                for (const signal of project.signals) {
                  await dbManager.db.insert(dbManager.schema.projectSignals).values({
                    id: `${project.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    projectId: project.id,
                    type: 'signal',
                    path: signal,
                    confidence: 1.0
                  }).onConflictDoNothing()
                }
              }

              // Store classification
              if (project.classification?.primary) {
                await dbManager.db.insert(dbManager.schema.projectClassification).values({
                  projectId: project.id,
                  categories: JSON.stringify([project.classification.primary.id]),
                  frameworks: JSON.stringify(project.classification.frameworks || []),
                  languages: JSON.stringify([project.classification.language]),
                  confidence: project.classification.primary.confidence,
                  metadata: JSON.stringify(project.metadata)
                }).onConflictDoUpdate({
                  target: dbManager.schema.projectClassification.projectId,
                  set: {
                    categories: JSON.stringify([project.classification.primary.id]),
                    frameworks: JSON.stringify(project.classification.frameworks || []),
                    languages: JSON.stringify([project.classification.language]),
                    confidence: project.classification.primary.confidence,
                    metadata: JSON.stringify(project.metadata),
                    updatedAt: new Date().toISOString()
                  }
                })
              }
            } catch (error) {
              request.log.warn(`Failed to store project ${project.id}:`, error)
            }
          }
        }

        // Broadcast to WebSocket clients
        this.broadcastWebSocket({
          type: 'discovery_completed',
          projects: projects.map(p => ({
            id: p.id,
            name: p.name,
            path: p.path,
            classification: p.classification?.primary?.name,
            detectedAt: p.detectedAt
          }))
        })

        return {
          success: true,
          projects,
          count: projects.length,
          scannedPath: scanPath
        }

      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({
          error: 'Discovery scan failed',
          details: error.message
        })
      }
    })

    this.server.get('/api/discovery/project/:path', async (request, reply) => {
      try {
        const projectPath = decodeURIComponent(request.params.path)
        const refresh = request.query.refresh === 'true'

        let project
        if (refresh) {
          project = await discoveryService.refreshProject(projectPath)
        } else {
          project = await discoveryService.discoverProject(projectPath)
        }

        if (!project.detected) {
          return reply.code(404).send({
            error: 'Project not detected',
            reason: project.reason || 'Unknown reason'
          })
        }

        return project

      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({
          error: 'Project discovery failed',
          details: error.message
        })
      }
    })

    this.server.post('/api/discovery/index', async (request, reply) => {
      try {
        const { paths } = request.body

        if (!paths || !Array.isArray(paths)) {
          return reply.code(400).send({ error: 'Paths array is required' })
        }

        const results = []

        for (const path of paths) {
          try {
            const project = await discoveryService.discoverProject(path)
            results.push({ path, success: true, project })
          } catch (error) {
            results.push({ path, success: false, error: error.message })
          }
        }

        const successful = results.filter(r => r.success && r.project.detected)

        return {
          success: true,
          results,
          discovered: successful.length,
          total: paths.length
        }

      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({
          error: 'Batch discovery failed',
          details: error.message
        })
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

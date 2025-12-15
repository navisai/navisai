/**
 * Navis Daemon - Main Entry Point (HTTPS)
 * Local-first backend for development environment control
 * Serves HTTPS at https://navis.local with onboarding flow
 */

import Fastify from 'fastify'
import { WebSocketServer } from 'ws'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import dbManager from '../../../packages/db/index.js'
import { projectsRepo, devicesRepo, approvalsRepo } from '../../../packages/db/repositories.js'
import { discoveryService } from '../../../packages/discovery/service.js'
import { CertificateManager } from './ssl.js'
import { MDNSAnnouncer } from './mdns.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

class NavisDaemon {
  constructor() {
    this.server = null
    this.wss = null
    this.port = 3415 // Default port, will be configurable later
    this.isRunning = false
    this.sslManager = null
    this.mdnsAnnouncer = null
  }

  async start() {
    try {
      console.log('Starting Navis daemon with HTTPS...')

      // Initialize SSL certificates
      this.sslManager = new CertificateManager()
      await this.sslManager.ensureCertificates()
      console.log('SSL certificates initialized')

      // Initialize database
      await dbManager.initialize()
      console.log('Database initialized')

      // Create HTTPS server
      this.server = Fastify({
        logger: {
          level: 'info',
          transport: {
            target: 'pino-pretty',
          },
        },
        https: await this.sslManager.getServerOptions()
      })

      // Register routes
      await this.registerRoutes()

      // Create WebSocket server (will be upgraded from HTTPS)
      this.wss = new WebSocketServer({ noServer: true })

      // Start the HTTPS server
      const httpsServer = await this.server.listen({
        port: this.port,
        host: '0.0.0.0'  // Listen on all interfaces for navis.local
      })

      // Handle WebSocket upgrade
      httpsServer.on('upgrade', (request, socket, head) => {
        if (request.url === '/ws') {
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request)
          })
        } else {
          socket.destroy()
        }
      })

      // Start mDNS announcer
      this.mdnsAnnouncer = new MDNSAnnouncer(this.port)
      this.mdnsAnnouncer.start()

      console.log(`🚀 Navis daemon running on https://navis.local:${this.port}`)
      console.log(`📡 WebSocket server ready at wss://navis.local:${this.port}/ws`)
      console.log(`👋 Onboarding flow available at https://navis.local:${this.port}/welcome`)

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
    // Onboarding routes
    await this.server.register(import('./routes/onboarding.js'))

    // Serve PWA static files
    this.server.get('/', async (request, reply) => {
      try {
        const pwaIndexPath = join(__dirname, '../../../pwa/build/index.html')

        // Check if PWA is built, fallback to onboarding
        try {
          await access(pwaIndexPath)
          const content = await readFile(pwaIndexPath, 'utf8')
          reply.type('text/html')
          return content
        } catch {
          // PWA not built, redirect to onboarding
          reply.redirect('/welcome')
        }
      } catch (error) {
        reply.code(500).send('<h1>Error loading Navis</h1>')
      }
    })

    // Serve PWA assets (if built)
    this.server.get('/pwa/*', async (request, reply) => {
      try {
        const assetPath = join(__dirname, '../../../pwa/build', request.params['*'])
        const content = await readFile(assetPath)

        // Set content type based on file extension
        const ext = assetPath.split('.').pop()
        const contentTypes = {
          'js': 'application/javascript',
          'css': 'text/css',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'svg': 'image/svg+xml',
          'json': 'application/json',
          'woff2': 'font/woff2',
          'woff': 'font/woff'
        }

        if (contentTypes[ext]) {
          reply.type(contentTypes[ext])
        }

        return content
      } catch (error) {
        reply.code(404).send('Asset not found')
      }
    })

    // Health check endpoint
    this.server.get('/api/status', async (request, reply) => {
      return {
        status: 'running',
        version: '0.1.0',
        database: dbManager.isAvailable(),
        port: this.port,
        ssl: true,
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

    if (this.mdnsAnnouncer) {
      this.mdnsAnnouncer.stop()
    }

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

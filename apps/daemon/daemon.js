#!/usr/bin/env node

/**
 * NavisAI Daemon
 * The authoritative control plane for NavisAI
 */

import Fastify from 'fastify'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
// Local config for now
const DEFAULT_CONFIG = {
  daemon: {
    port: 47621,
    host: '0.0.0.0',
    ssl: {
      selfSigned: true,
      certPath: null,
      keyPath: null
    }
  },
  discovery: {
    enabled: true,
    mdns: true,
    scanDepth: 3,
    maxConcurrency: 5
  },
  logging: {
    level: 'info',
    pretty: true
  },
  api: {
    endpoints: {
      status: '/status',
      projects: '/projects',
      sessions: '/sessions',
      approvals: '/approvals',
      pairing: '/pairing',
      welcome: '/welcome',
      ws: '/ws'
    }
  }
}
import { SSLManager } from './ssl-manager.js'
import { WebSocketManager } from './websocket-manager.js'
import { createAuthMiddleware } from './middleware/auth.js'
import { ProjectService } from './services/project.js'
import { SessionService } from './services/session.js'
import { ApprovalService } from './services/approval.js'
import { PairingService } from './services/pairing.js'

export class NavisDaemon {
  constructor() {
    this.fastify = Fastify({
      logger: { level: 'info' }
    })
    this.httpsServer = null
    this.sslManager = new SSLManager()
    this.wsManager = null
    this.config = {
      get: (key) => {
        let obj = DEFAULT_CONFIG
        for (const k of key.split('.')) {
          obj = obj?.[k]
        }
        return obj
      },
      set: (key, value) => {
        let obj = DEFAULT_CONFIG
        const keys = key.split('.')
        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i]
          obj[k] = obj[k] || {}
          obj = obj[k]
        }
        obj[keys[keys.length - 1]] = value
      }
    }
    this.isRunning = false

    // Services
    this.projectService = null
    this.sessionService = null
    this.approvalService = null
    this.pairingService = null

    // mDNS service
    this.mdnsService = null
  }

  async start() {
    try {
      console.log('🚀 Starting Navis daemon...')

      // Override port from environment if set
      if (process.env.NAVIS_PORT) {
        DEFAULT_CONFIG.daemon.port = parseInt(process.env.NAVIS_PORT)
      }

      // Try to find the best available port
      const port = await this.findAvailablePort()
      const host = this.config.get('daemon.host')

      // Update config with the chosen port
      this.config.set('daemon.port', port)

      // Initialize SSL certificates
      await this.sslManager.ensureCertificates()
      const sslOptions = await this.sslManager.getSSLOptions()

      // Create HTTPS server
      this.httpsServer = createServer(sslOptions, this.fastify.server)

      // Initialize services
      await this.initializeServices()

      // Setup routes
      await this.setupRoutes()

      // Setup WebSocket
      this.wsManager = new WebSocketManager(this.fastify)
      await this.wsManager.initialize()

      // Start the server
      await this.fastify.listen({ port, host })

      // Setup mDNS if enabled
      if (this.config.get('discovery.mdns')) {
        await this.setupMDNS()
      }

      this.isRunning = true

      console.log(`\n✅ Navis daemon is running!`)

      if (port === 443) {
        console.log(`🌐 Seamless access: https://navis.local`)
        console.log(`📱 Onboarding: https://navis.local/welcome`)
        console.log(`📊 API: https://navis.local/api/status`)
      } else {
        console.log(`🌐 Access at: https://navis.local:${port}`)
        console.log(`📱 Onboarding: https://navis.local:${port}/welcome`)
        console.log(`📊 API: https://navis.local:${port}/api/status`)
        console.log(`\n💡 For portless access, run with sudo: sudo navisai up`)
      }

    } catch (error) {
      if (error.code === 'EACCES') {
        console.error('\n❌ Permission denied binding to port 443')
        console.error('   To run on port 443 for seamless https://navis.local access:')
        console.error('   sudo navisai up')
        console.error('\n   Or run without sudo for ported access:')
        console.error('   navisai up\n')
        process.exit(1)
      }
      console.error('\n❌ Failed to start daemon:', error.message)
      throw error
    }
  }

  async findAvailablePort() {
    // If port is explicitly set via environment, respect it
    if (process.env.NAVIS_PORT) {
      return parseInt(process.env.NAVIS_PORT)
    }

    // Use default port 47621 as specified in IPC_TRANSPORT.md
    // Reference: docs/IPC_TRANSPORT.md - "Default port: 47621 (example; configurable)"
    const ports = [47621, 47622, 47623, 8443]

    for (const port of ports) {
      try {
        // Test if we can bind to this port
        const net = await import('node:net')
        const server = net.default.createServer()

        await new Promise((resolve, reject) => {
          server.listen(port, '0.0.0.0', () => {
            server.close(() => resolve())
          })
          server.on('error', reject)
        })

        // If we get here, we can bind to the port
        return port
      } catch (error) {
        // Skip ports we can't bind to
        if (error.code === 'EACCES' || error.code === 'EADDRINUSE') {
          continue
        }

      }
    }

    // If all ports fail, return default
    return 47621
  }

  async initializeServices() {
    // Ensure data directory exists
    const dataDir = join(homedir(), '.navis')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    // Initialize all services
    this.projectService = new ProjectService()
    await this.projectService.initialize()

    this.sessionService = new SessionService()
    await this.sessionService.initialize()

    this.approvalService = new ApprovalService()
    await this.approvalService.initialize()

    this.pairingService = new PairingService()
    await this.pairingService.initialize()
  }

  async setupRoutes() {
    const apiPrefix = '/api'

    // Add authentication middleware
    const authMiddleware = createAuthMiddleware(this.dbManager)
    this.fastify.addHook('preHandler', authMiddleware)

    // Public endpoints (no auth required)
    this.fastify.get('/welcome', this.getWelcomeHandler.bind(this))
    this.fastify.get(`${apiPrefix}/status`, this.getStatusHandler.bind(this))
    this.fastify.post(`${apiPrefix}/pairing/request`, this.pairingService.handleRequest.bind(this.pairingService))

    // Auth-required endpoints (will add middleware)
    this.fastify.get(`${apiPrefix}/projects`, this.getProjectsHandler.bind(this))
    this.fastify.get(`${apiPrefix}/projects/:id`, this.getProjectHandler.bind(this))
    this.fastify.get(`${apiPrefix}/sessions`, this.getSessionsHandler.bind(this))
    this.fastify.get(`${apiPrefix}/approvals`, this.getApprovalsHandler.bind(this))
    this.fastify.post(`${apiPrefix}/approvals/:id/approve`, this.approveHandler.bind(this))
    this.fastify.post(`${apiPrefix}/approvals/:id/reject`, this.rejectHandler.bind(this))

    // Device management
    this.fastify.get(`${apiPrefix}/devices`, this.getDevicesHandler.bind(this))
    this.fastify.post(`${apiPrefix}/devices/:id/revoke`, this.revokeDeviceHandler.bind(this))

    // Discovery endpoints
    this.fastify.post(`${apiPrefix}/discovery/scan`, this.scanHandler.bind(this))
    this.fastify.post(`${apiPrefix}/discovery/index`, this.indexHandler.bind(this))

    // Logs endpoint
    this.fastify.get(`${apiPrefix}/logs`, this.getLogsHandler.bind(this))

    // Pairing QR endpoint
    this.fastify.get('/pairing/qr', this.getPairingQRHandler.bind(this))

    // Serve PWA (static files)
    this.fastify.register(require('@fastify/static'), {
      root: join(__dirname, '..', 'pwa', 'build'),
      prefix: '/'
    })
  }

  async setupMDNS() {
    try {
      const { default: bonjour } = await import('bonjour-service')

      this.mdnsService = bonjour().publish({
        name: 'NavisAI',
        type: 'https',
        port: this.config.get('daemon.port'),
        txt: {
          path: '/welcome',
          version: '0.1.0'
        }
      })

      console.log('🔍 mDNS service announced')
    } catch (error) {
      console.log('⚠️  mDNS not available:', error.message)
    }
  }

  // Route handlers
  async getWelcomeHandler(request, reply) {
    reply.type('text/html')

    // Get pairing data for QR code
    const pairingData = this.pairingService ? await this.pairingService.generatePairingData() : null

    return `<!DOCTYPE html>
<html>
<head>
    <title>NavisAI - Welcome</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        navis: {
                            50: '#f0f9ff',
                            500: '#3b82f6',
                            600: '#2563eb',
                            900: '#1e3a8a'
                        }
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-gray-50 min-h-screen">
    <div class="container mx-auto px-4 py-8 max-w-4xl">
        <!-- Header -->
        <div class="text-center mb-8">
            <h1 class="text-4xl font-bold text-navis-900 mb-2">
                🧭 NavisAI
            </h1>
            <p class="text-lg text-gray-600">Local-first Developer Control Plane</p>
        </div>

        <!-- Status Card -->
        <div class="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
            <h2 class="text-xl font-semibold text-green-800 mb-2">
                ✅ Navis is running locally
            </h2>
            <p class="text-green-700">
                Your daemon is active and ready to pair with devices.
                All data stays on your machine - no cloud dependencies.
            </p>
        </div>

        <!-- How Navis Works -->
        <div class="bg-white rounded-lg shadow-sm p-6 mb-8">
            <h2 class="text-2xl font-bold text-navis-900 mb-4">How Navis Works</h2>
            <div class="grid md:grid-cols-3 gap-4 text-center">
                <div class="p-4">
                    <div class="text-3xl mb-2">💻</div>
                    <h3 class="font-semibold mb-1">Your Laptop</h3>
                    <p class="text-sm text-gray-600">Runs the Navis daemon</p>
                </div>
                <div class="p-4">
                    <div class="text-3xl mb-2">📱</div>
                    <h3 class="font-semibold mb-1">Your Phone</h3>
                    <p class="text-sm text-gray-600">Connects via PWA</p>
                </div>
                <div class="p-4">
                    <div class="text-3xl mb-2">🔗</div>
                    <h3 class="font-semibold mb-1">Navis Daemon</h3>
                    <p class="text-sm text-gray-600">Secure local bridge</p>
                </div>
            </div>
        </div>

        <!-- Pairing Section -->
        <div class="bg-white rounded-lg shadow-sm p-6 mb-8">
            <h2 class="text-2xl font-bold text-navis-900 mb-4">Connect Your Device</h2>

            <div class="grid md:grid-cols-2 gap-6">
                <!-- QR Code Option -->
                <div class="text-center p-4 border-2 border-gray-200 rounded-lg hover:border-navis-500 transition-colors">
                    <div class="text-2xl mb-2">📷</div>
                    <h3 class="font-semibold mb-2">Scan QR Code</h3>
                    ${pairingData ? `
                        <div class="inline-block p-4 bg-white border rounded">
                            <img src="/pairing/qr" alt="Pairing QR Code" class="w-48 h-48" />
                        </div>
                        <p class="text-sm text-gray-600 mt-2">
                            Pairing code: <code class="bg-gray-100 px-2 py-1 rounded">${pairingData.id.toUpperCase()}</code>
                        </p>
                    ` : `
                        <p class="text-sm text-gray-600">Generating pairing code...</p>
                    `}
                </div>

                <!-- Direct URL Option -->
                <div class="text-center p-4 border-2 border-gray-200 rounded-lg hover:border-navis-500 transition-colors">
                    <div class="text-2xl mb-2">🌐</div>
                    <h3 class="font-semibold mb-2">Direct Access</h3>
                    <p class="text-sm text-gray-600 mb-4">
                        On your phone, visit:
                    </p>
                    <a href="https://navis.local" class="text-navis-600 hover:text-navis-800 font-mono text-sm break-all">
                        https://navis.local
                    </a>
                    <p class="text-xs text-gray-500 mt-2">
                        Accept the security certificate when prompted
                    </p>
                </div>
            </div>
        </div>

        <!-- Local Discovery Status -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="font-semibold text-blue-800">Discovery Active</h3>
                    <p class="text-sm text-blue-700">mDNS and BLE signals are broadcasting</p>
                </div>
                <div class="animate-pulse">
                    <span class="inline-block w-3 h-3 bg-blue-500 rounded-full"></span>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Auto-refresh QR code and pairing status
        setInterval(async () => {
            try {
                const response = await fetch('/api/status')
                const status = await response.json()

                // Update UI based on pairing status
                if (status.paired) {
                    window.location.href = '/'
                }
            } catch (error) {
                console.error('Failed to check status:', error)
            }
        }, 5000)
    </script>
</body>
</html>`
  }

  async getStatusHandler(request, reply) {
    return {
      status: 'running',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      database: true,
      paired: this.pairingService ? await this.pairingService.hasPairedDevices() : false,
      endpoints: this.config.get('api.endpoints')
    }
  }

  async getProjectsHandler(request, reply) {
    // TODO: Add auth middleware
    if (!this.projectService) {
      return { projects: [] }
    }
    return await this.projectService.listProjects()
  }

  async getProjectHandler(request, reply) {
    // TODO: Add auth middleware
    const { id } = request.params
    if (!this.projectService) {
      reply.code(404)
      return { error: 'Project not found' }
    }
    return await this.projectService.getProject(id)
  }

  async getSessionsHandler(request, reply) {
    // TODO: Add auth middleware
    if (!this.sessionService) {
      return { sessions: [] }
    }
    return await this.sessionService.listSessions()
  }

  async getApprovalsHandler(request, reply) {
    // TODO: Add auth middleware
    if (!this.approvalService) {
      return { approvals: [] }
    }
    return await this.approvalService.listApprovals()
  }

  async approveHandler(request, reply) {
    // TODO: Add auth middleware
    const { id } = request.params
    if (!this.approvalService) {
      reply.code(404)
      return { error: 'Approval not found' }
    }
    return await this.approvalService.approve(id)
  }

  async rejectHandler(request, reply) {
    // TODO: Add auth middleware
    const { id } = request.params
    if (!this.approvalService) {
      reply.code(404)
      return { error: 'Approval not found' }
    }
    return await this.approvalService.reject(id)
  }

  async getDevicesHandler(request, reply) {
    // TODO: Add auth middleware
    if (!this.pairingService) {
      return { devices: [] }
    }
    return await this.pairingService.listDevices()
  }

  async revokeDeviceHandler(request, reply) {
    // TODO: Add auth middleware
    const { id } = request.params
    if (!this.pairingService) {
      reply.code(404)
      return { error: 'Device not found' }
    }
    return await this.pairingService.revokeDevice(id)
  }

  async scanHandler(request, reply) {
    // TODO: Add auth middleware and implement scan
    const { path, options } = request.body
    return {
      scannedPath: path,
      count: 0,
      projects: []
    }
  }

  async indexHandler(request, reply) {
    // TODO: Add auth middleware and implement indexing
    const { paths } = request.body
    return {
      total: paths.length,
      discovered: 0,
      results: paths.map(p => ({
        path: p,
        success: false,
        error: 'Not implemented'
      }))
    }
  }

  async getLogsHandler(request, reply) {
    // TODO: Add auth middleware and implement log streaming
    return {
      logs: [],
      levels: ['error', 'warn', 'info', 'debug']
    }
  }

  async getPairingQRHandler(request, reply) {
    if (!this.pairingService) {
      reply.code(503)
      return { error: 'Pairing service not available' }
    }

    const { qrImage } = await this.pairingService.generateQR()

    // Extract base64 data from data URL
    const base64Data = qrImage.split(',')[1]
    const imgBuffer = Buffer.from(base64Data, 'base64')

    reply.type('image/png')
    return imgBuffer
  }

  async stop() {
    console.log('\n🛑 Stopping Navis daemon...')

    if (this.mdnsService) {
      this.mdnsService.stop()
    }

    if (this.wsManager) {
      await this.wsManager.close()
    }

    if (this.httpsServer) {
      this.httpsServer.close()
    }

    this.isRunning = false
    console.log('✅ Daemon stopped')
  }
}

// Create and export daemon instance
export default new NavisDaemon()

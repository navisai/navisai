#!/usr/bin/env node

/**
 * NavisAI Daemon
 * The authoritative control plane for NavisAI
 */

import Fastify from 'fastify'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir, networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import multicastDns from 'multicast-dns'
import fastifyStatic from '@fastify/static'
import { NAVIS_PATHS } from '@navisai/api-contracts'
import dbManager from '@navisai/db'
// Local config for now
const DEFAULT_CONFIG = {
  daemon: {
    port: 47621,
    host: '127.0.0.1',
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

const __dirname = dirname(fileURLToPath(import.meta.url))

export class NavisDaemon {
  constructor() {
    this.fastify = null
    this.sslManager = new SSLManager()
    this.wsManager = null
    this.dbManager = null
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

    // mDNS responder
    this.mdns = null
  }

  getLanAddress() {
    const interfaces = networkInterfaces()
    for (const addrs of Object.values(interfaces)) {
      for (const addr of addrs || []) {
        if (addr && addr.family === 'IPv4' && addr.internal === false) {
          return addr.address
        }
      }
    }
    return null
  }

  async start() {
    try {
      console.log('🚀 Starting Navis daemon...')

      // Override port from environment if set
      if (process.env.NAVIS_PORT) {
        DEFAULT_CONFIG.daemon.port = parseInt(process.env.NAVIS_PORT)
      }

      const port = this.config.get('daemon.port')
      const host = this.config.get('daemon.host')

      // Update config with the chosen port
      this.config.set('daemon.port', port)

      // Initialize SSL certificates
      await this.sslManager.ensureCertificates()
      const sslOptions = await this.sslManager.getSSLOptions()

      this.fastify = Fastify({
        logger: { level: 'info' },
        https: sslOptions
      })

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
      console.log(`📱 Onboarding: https://navis.local/welcome`)
      console.log(`📊 Status: https://navis.local/status`)
    } catch (error) {
      console.error('\n❌ Failed to start daemon:', error.message)
      throw error
    }
  }

  async initializeServices() {
    // Ensure data directory exists
    const dataDir = join(homedir(), '.navis')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    // Initialize database (required)
    await dbManager.initialize()
    this.dbManager = dbManager

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
    // Add authentication middleware
    const authMiddleware = createAuthMiddleware(this.dbManager)
    this.fastify.addHook('preHandler', authMiddleware)

    // Public endpoints (no auth required)
    this.fastify.get(NAVIS_PATHS.status, this.getStatusHandler.bind(this))
    this.fastify.post(NAVIS_PATHS.pairing.request, this.pairingService.handleRequest.bind(this.pairingService))

    // Auth-required endpoints (will add middleware)
    this.fastify.get(NAVIS_PATHS.projects.list, this.getProjectsHandler.bind(this))
    this.fastify.get('/projects/:id', this.getProjectHandler.bind(this))
    this.fastify.get(NAVIS_PATHS.sessions, this.getSessionsHandler.bind(this))
    this.fastify.get(NAVIS_PATHS.approvals.list, this.getApprovalsHandler.bind(this))
    this.fastify.get(NAVIS_PATHS.approvals.pending, this.getPendingApprovalsHandler.bind(this))
    this.fastify.post('/approvals/:id/approve', this.approveHandler.bind(this))
    this.fastify.post('/approvals/:id/reject', this.rejectHandler.bind(this))

    // Device management
    this.fastify.get(NAVIS_PATHS.devices.list, this.getDevicesHandler.bind(this))
    this.fastify.post('/devices/:id/revoke', this.revokeDeviceHandler.bind(this))

    // Discovery endpoints
    this.fastify.post(NAVIS_PATHS.discovery.scan, this.scanHandler.bind(this))
    this.fastify.post(NAVIS_PATHS.discovery.index, this.indexHandler.bind(this))

    // Logs endpoint
    this.fastify.get('/logs', this.getLogsHandler.bind(this))

    // Pairing QR endpoint
    this.fastify.get('/pairing/qr', this.getPairingQRHandler.bind(this))

    const pwaRoot = join(__dirname, '..', 'pwa', 'build')
    const pwaIndex = join(pwaRoot, 'index.html')

    if (existsSync(pwaIndex)) {
      this.fastify.register(fastifyStatic, {
        root: pwaRoot,
        prefix: '/',
      })

      this.fastify.setNotFoundHandler((request, reply) => {
        if (request.method === 'GET') {
          return reply.sendFile('index.html')
        }
        reply.code(404).send({ error: 'Not found' })
      })
    } else {
      this.fastify.get(NAVIS_PATHS.welcome, async () => {
        return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>NavisAI</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#f8fafc; margin:0; }
      .wrap { max-width: 720px; margin: 0 auto; padding: 32px 16px; }
      .card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1 style="margin:0 0 8px;">NavisAI</h1>
        <p style="margin:0 0 12px; color:#475569;">PWA assets are not present yet.</p>
        <p style="margin:0 0 12px; color:#475569;">Build the PWA and restart the daemon:</p>
        <pre style="margin:0; padding:12px; background:#f1f5f9; border-radius:10px;"><code>pnpm --filter @navisai/pwa build
pnpm --filter @navisai/daemon dev</code></pre>
      </div>
    </div>
  </body>
</html>`
      })
    }
  }

  async setupMDNS() {
    try {
      const ip = this.getLanAddress()
      if (!ip) {
        console.log('⚠️  mDNS not started: no LAN IPv4 address detected')
        return
      }

      const port = 443
      this.mdns = multicastDns()

      this.mdns.on('query', (query) => {
        const questions = query.questions || []
        for (const q of questions) {
          if (q.name === 'navis.local' && q.type === 'A') {
            this.mdns.respond({
              answers: [{ name: 'navis.local', type: 'A', ttl: 120, data: ip }],
            })
          }
        }
      })

      this.mdns.respond({
        answers: [
          {
            name: '_navisai._tcp.local',
            type: 'PTR',
            data: 'NavisAI._navisai._tcp.local',
            ttl: 120,
          },
          {
            name: 'NavisAI._navisai._tcp.local',
            type: 'SRV',
            data: { port, weight: 0, priority: 10, target: 'navis.local' },
            ttl: 120,
          },
          {
            name: 'NavisAI._navisai._tcp.local',
            type: 'TXT',
            data: ['version=1', 'tls=1', 'origin=https://navis.local'],
            ttl: 120,
          },
          { name: 'navis.local', type: 'A', ttl: 120, data: ip },
        ],
      })

      console.log('🔍 mDNS active for navis.local', { ip })
    } catch (error) {
      console.log('⚠️  mDNS not available:', error.message)
    }
  }

  // Route handlers
  async getStatusHandler(request, reply) {
    const db = this.dbManager ? await this.dbManager.healthCheck() : { available: false }
    return {
      status: 'running',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      database: db.available,
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

  async getPendingApprovalsHandler(request, reply) {
    // TODO: Add auth middleware
    if (!this.approvalService) {
      return { approvals: [] }
    }
    const result = await this.approvalService.listApprovals()
    return {
      approvals: (result.approvals || []).filter(a => a.status === 'pending')
    }
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

    if (this.mdns) {
      this.mdns.destroy()
      this.mdns = null
    }

    if (this.wsManager) {
      await this.wsManager.close()
    }

    if (this.fastify) await this.fastify.close()

    if (this.dbManager) {
      await this.dbManager.close()
      this.dbManager = null
    }

    this.isRunning = false
    console.log('✅ Daemon stopped')
  }
}

// Create and export daemon instance
export default new NavisDaemon()

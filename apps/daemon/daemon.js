#!/usr/bin/env node

/**
 * NavisAI Daemon
 * The authoritative control plane for NavisAI
 */

import Fastify from 'fastify'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
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
    this.fastify.get('/welcome', this.getWelcomeHandler.bind(this))
    this.fastify.get('/status', this.getStatusHandler.bind(this))
    this.fastify.post('/pairing/request', this.pairingService.handleRequest.bind(this.pairingService))

    // Auth-required endpoints (will add middleware)
    this.fastify.get('/projects', this.getProjectsHandler.bind(this))
    this.fastify.get('/projects/:id', this.getProjectHandler.bind(this))
    this.fastify.get('/sessions', this.getSessionsHandler.bind(this))
    this.fastify.get('/approvals', this.getApprovalsHandler.bind(this))
    this.fastify.get('/approvals/pending', this.getPendingApprovalsHandler.bind(this))
    this.fastify.post('/approvals/:id/approve', this.approveHandler.bind(this))
    this.fastify.post('/approvals/:id/reject', this.rejectHandler.bind(this))

    // Device management
    this.fastify.get('/devices', this.getDevicesHandler.bind(this))
    this.fastify.post('/devices/:id/revoke', this.revokeDeviceHandler.bind(this))

    // Discovery endpoints
    this.fastify.post('/discovery/scan', this.scanHandler.bind(this))
    this.fastify.post('/discovery/index', this.indexHandler.bind(this))

    // Logs endpoint
    this.fastify.get('/logs', this.getLogsHandler.bind(this))

    // Pairing QR endpoint
    this.fastify.get('/pairing/qr', this.getPairingQRHandler.bind(this))
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
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #f8fafc; margin: 0; }
      .container { max-width: 880px; margin: 0 auto; padding: 32px 16px; }
      .card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 10px rgba(15,23,42,0.06); border: 1px solid #e2e8f0; }
      .title { font-size: 28px; font-weight: 700; color: #0f172a; margin: 0 0 6px; }
      .muted { color: #475569; margin: 0 0 18px; }
      .row { display: grid; grid-template-columns: 1fr; gap: 16px; }
      @media (min-width: 768px) { .row { grid-template-columns: 1fr 1fr; } }
      .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #ecfeff; color: #0f766e; font-weight: 600; font-size: 12px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      img { max-width: 100%; height: auto; border-radius: 10px; }
      a { color: #0ea5e9; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .subcard { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
    </style>
</head>
<body>
    <div class="container">
      <div class="card">
        <div class="badge">Onboarding</div>
        <h1 class="title">NavisAI is running</h1>
        <p class="muted">Open this page on your phone to pair, or scan the QR code.</p>

        <div class="row">
          <div class="subcard">
            <h2 style="margin:0 0 8px; font-size:16px;">Scan QR</h2>
            ${pairingData ? `<img src="/pairing/qr" alt="Pairing QR Code" />` : `<p class="muted">Generating...</p>`}
            ${pairingData ? `<p class="muted" style="margin-top:10px; font-size:12px;">Code: <span class="mono">${pairingData.id.toUpperCase()}</span></p>` : ``}
          </div>
          <div class="subcard">
            <h2 style="margin:0 0 8px; font-size:16px;">Open on phone</h2>
            <p class="muted" style="margin-bottom:10px;">Visit:</p>
            <div class="mono"><a href="https://navis.local/welcome">https://navis.local/welcome</a></div>
            <p class="muted" style="margin-top:10px; font-size:12px;">If prompted, accept the local certificate.</p>
          </div>
        </div>
      </div>
    </div>

    <script>
        // Auto-refresh QR code and pairing status
        setInterval(async () => {
            try {
                const response = await fetch('/status')
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

    if (this.mdnsService) {
      this.mdnsService.stop()
    }

    if (this.wsManager) {
      await this.wsManager.close()
    }

    if (this.fastify) await this.fastify.close()

    this.isRunning = false
    console.log('✅ Daemon stopped')
  }
}

// Create and export daemon instance
export default new NavisDaemon()

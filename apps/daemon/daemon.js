#!/usr/bin/env node

/**
 * NavisAI Daemon
 * The authoritative control plane for NavisAI
 */

import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
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
import { BleAdvertiser } from './services/ble.js'
import { logStore } from './log-store.js'
import { logger } from '@navisai/logging'

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
    this.bleAdvertiser = null


  }



  setupLogCapture() {
    // Override console methods to capture logs
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug
    }

    const captureLog = (level, args) => {
      const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ')

      const logEntry = {
        level: level.toUpperCase(),
        message,
        timestamp: new Date().toISOString(),
        source: 'daemon'
      }

      // Store in log buffer for streaming
      logStore.addLog(logEntry)

      // Also broadcast to WebSocket clients
      if (this.wsManager) {
        this.wsManager.broadcast({ type: 'log', data: logEntry }, 'logs')
      }

      // Call original console method
      originalConsole[level](...args)
    }

    // Override console methods
    console.log = (...args) => captureLog('info', args)
    console.error = (...args) => captureLog('error', args)
    console.warn = (...args) => captureLog('warn', args)
    console.info = (...args) => captureLog('info', args)
    console.debug = (...args) => captureLog('debug', args)

    // Override shared logger
    const originalLog = logger.log
    logger.log = (level, message, meta = {}) => {
      const logEntry = {
        level: level.toUpperCase(),
        message,
        ...meta,
        timestamp: new Date().toISOString(),
        source: 'daemon'
      }

      logStore.addLog(logEntry)

      if (this.wsManager) {
        this.wsManager.broadcast({ type: 'log', data: logEntry }, 'logs')
      }

      return originalLog.call(logger, level, message, meta)
    }
  }

  async start() {
    try {
      console.log('🚀 Starting Navis daemon...')

      // Set up log capture - Refs: navisai-jma
      this.setupLogCapture()

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



      // Register security middleware - Refs: navisai-zs3
      await this.fastify.register(helmet, {
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "'wss:'", "'https:'"]
          }
        },
        hsts: {
          includeSubDomains: true,
          preload: true
        }
      })

      // Configure CORS per IPC_TRANSPORT.md - Refs: navisai-zs3
      await this.fastify.register(cors, {
        origin: (origin, callback) => {
          // Allow same origin and navis.local
          if (!origin || origin.includes("navis.local")) {
            return callback(null, true)
          }
          // Check config for additional allowed origins
          const allowedOrigins = this.config.daemon?.allowedOrigins || []
          if (allowedOrigins.includes(origin)) {
            return callback(null, true)
          }
          callback(new Error("Not allowed by CORS"))
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
      })

      // Rate limiting - Refs: navisai-zs3
      await this.fastify.register(rateLimit, {
        max: 100,
        timeWindow: "1 minute",
        skipOnError: true
      })
      // Initialize services
      await this.initializeServices()

      // Setup routes
      await this.setupRoutes()

      // Setup WebSocket
      this.wsManager = new WebSocketManager(this.fastify, this.dbManager)
      await this.wsManager.initialize()
      this.approvalService?.setWebSocketManager(this.wsManager)

      // Start the server
      await this.fastify.listen({ port, host })

      // Note: mDNS is now handled by the bridge service

      // Optional BLE onboarding signal (only when unpaired)
      try {
        const paired = this.pairingService ? await this.pairingService.hasPairedDevices() : false
        if (!paired) {
          await this.bleAdvertiser?.start?.()
        }
      } catch { }

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

    this.bleAdvertiser = new BleAdvertiser()

    this.pairingService = new PairingService({
      approvalService: this.approvalService,
      dbManager: this.dbManager,
      bleAdvertiser: this.bleAdvertiser,
    })
    await this.pairingService.initialize()
  }

  async setupRoutes() {
    // Public endpoints (no auth required)
    this.fastify.get(NAVIS_PATHS.status, this.getStatusHandler.bind(this))
    this.fastify.get(NAVIS_PATHS.certs.navisLocalCrt, this.getCertHandler.bind(this))
    this.fastify.post(
      NAVIS_PATHS.pairing.start,
      this.pairingService.handleStart.bind(this.pairingService)
    )
    this.fastify.post(
      NAVIS_PATHS.pairing.request,
      this.pairingService.handleRequest.bind(this.pairingService)
    )

    // Auth-required endpoints - Add authentication middleware
    const authMiddleware = createAuthMiddleware(this.dbManager)

    // Projects endpoints
    this.fastify.get(NAVIS_PATHS.projects.list, {
      preHandler: authMiddleware
    }, this.getProjectsHandler.bind(this))
    this.fastify.get('/projects/:id', {
      preHandler: authMiddleware
    }, this.getProjectHandler.bind(this))

    // Sessions endpoints
    this.fastify.get(NAVIS_PATHS.sessions, {
      preHandler: authMiddleware
    }, this.getSessionsHandler.bind(this))

    // Approvals endpoints
    this.fastify.get(NAVIS_PATHS.approvals.list, {
      preHandler: authMiddleware
    }, this.getApprovalsHandler.bind(this))
    this.fastify.get(NAVIS_PATHS.approvals.pending, {
      preHandler: authMiddleware
    }, this.getPendingApprovalsHandler.bind(this))
    this.fastify.get('/approvals/:id', {
      preHandler: authMiddleware
    }, this.getApprovalHandler.bind(this))
    this.fastify.post('/approvals/:id/approve', {
      preHandler: authMiddleware
    }, this.approveHandler.bind(this))
    this.fastify.post('/approvals/:id/reject', {
      preHandler: authMiddleware
    }, this.rejectHandler.bind(this))

    // Device management
    this.fastify.get(NAVIS_PATHS.devices.list, {
      preHandler: authMiddleware
    }, this.getDevicesHandler.bind(this))
    this.fastify.post('/devices/:id/revoke', {
      preHandler: authMiddleware
    }, this.revokeDeviceHandler.bind(this))

    // Discovery endpoints
    this.fastify.post(NAVIS_PATHS.discovery.scan, {
      preHandler: authMiddleware
    }, this.scanHandler.bind(this))
    this.fastify.post(NAVIS_PATHS.discovery.index, {
      preHandler: authMiddleware
    }, this.indexHandler.bind(this))

    // Logs endpoints
    this.fastify.get('/logs', {
      preHandler: authMiddleware
    }, this.getLogsHandler.bind(this))
    this.fastify.get('/logs/stream', {
      preHandler: authMiddleware
    }, this.getLogStreamHandler.bind(this))

    // Pairing QR endpoint
    this.fastify.get('/pairing/qr', {
      preHandler: authMiddleware
    }, this.getPairingQRHandler.bind(this))

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

  async getCertHandler(request, reply) {
    try {
      const cert = await readFile(this.sslManager.certFile)
      reply.type('application/x-x509-ca-cert')
      return cert
    } catch {
      reply.code(404)
      return { error: 'Certificate not found' }
    }
  }

  async getProjectsHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    if (!this.projectService) {
      return { projects: [] }
    }
    return await this.projectService.listProjects()
  }

  async getProjectHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    const { id } = request.params
    if (!this.projectService) {
      reply.code(404)
      return { error: 'Project not found' }
    }
    return await this.projectService.getProject(id)
  }

  async getSessionsHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    if (!this.sessionService) {
      return { sessions: [] }
    }
    return await this.sessionService.listSessions()
  }

  async getApprovalsHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    if (!this.approvalService) {
      return { approvals: [] }
    }
    return await this.approvalService.listApprovals()
  }

  async getPendingApprovalsHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    if (!this.approvalService) {
      return { approvals: [] }
    }
    const result = await this.approvalService.listApprovals()
    return {
      approvals: (result.approvals || []).filter(a => a.status === 'pending')
    }
  }

  async approveHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    const { id } = request.params
    if (!this.approvalService) {
      reply.code(404)
      return { error: 'Approval not found' }
    }
    const approval = await this.approvalService.approve(id)
    await this.pairingService?.onApprovalResolved?.(approval)
    return approval
  }

  async rejectHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    const { id } = request.params
    if (!this.approvalService) {
      reply.code(404)
      return { error: 'Approval not found' }
    }
    const approval = await this.approvalService.reject(id)
    await this.pairingService?.onApprovalResolved?.(approval)
    return approval
  }

  async getDevicesHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    if (!this.pairingService) {
      return { devices: [] }
    }
    return await this.pairingService.listDevices()
  }

  async revokeDeviceHandler(request, reply) {
    // Refs: navisai-0f0 (authentication middleware applied)
    const { id } = request.params
    if (!this.pairingService) {
      reply.code(404)
      return { error: 'Device not found' }
    }
    return await this.pairingService.revokeDevice(id)
  }

  async scanHandler(request, reply) {
    // Refs: navisai-4oi (discovery endpoint implementation needed)
    const { path, options } = request.body
    return {
      scannedPath: path,
      count: 0,
      projects: []
    }
  }

  async indexHandler(request, reply) {
    // Refs: navisai-4oi (discovery endpoint implementation needed)
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
    // Return recent logs from buffer
    const { limit = 100, level } = request.query
    let logs = logStore.getRecentLogs(parseInt(limit))

    if (level) {
      logs = logs.filter(log => log.level === level.toUpperCase())
    }

    return {
      logs,
      levels: ['error', 'warn', 'info', 'debug']
    }
  }

  async getLogStreamHandler(request, reply) {
    // Set up Server-Sent Events for log streaming
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    })

    // Send initial connection event
    reply.raw.write(`data: ${JSON.stringify({
      type: 'connected',
      timestamp: new Date().toISOString()
    })}\n\n`)

    // Add client to log store
    logStore.addClient(reply.raw)

    // Set up heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`)
      } catch (error) {
        clearInterval(heartbeat)
      }
    }, 30000)

    // Clean up on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      // Remove client from log store (handled by logStore.addClient)
    })

    // Also forward logs directly from logStore events for real-time streaming
    const onLog = (log) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(log)}\n\n`)
      } catch (error) {
        // Client disconnected
        clearInterval(heartbeat)
      }
    }

    logStore.on('log', onLog)

    request.raw.on('close', () => {
      logStore.off('log', onLog)
    })
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

    // Note: mDNS is now handled by the bridge service

    await this.bleAdvertiser?.stop?.()

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

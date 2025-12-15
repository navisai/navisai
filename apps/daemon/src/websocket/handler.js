/**
 * Navis Daemon WebSocket Handler
 * Manages WebSocket connections and message handling
 */

import { logger } from '@navisai/logging'

export class WebSocketHandler {
  constructor(wss, repositories, events) {
    this.wss = wss
    this.repositories = repositories
    this.events = events
    this.subscriptions = new Map() // clientId -> Set of subscribed events
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, request) {
    const clientId = this.generateClientId()
    ws.clientId = clientId
    this.subscriptions.set(clientId, new Set())

    logger.info('WebSocket client connected', {
      clientId,
      remoteAddress: request.socket.remoteAddress,
      userAgent: request.headers['user-agent']
    })

    // Send welcome message with current status
    this.events.sendToClient(ws, 'connected', {
      clientId,
      daemonUrl: 'https://navis.local:3415',
      version: '0.1.0'
    })

    // Set up message handlers
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString())
        await this.handleMessage(ws, message)
      } catch (error) {
        logger.warn('Invalid WebSocket message received', {
          clientId,
          error: error.message,
          data: data.toString()
        })

        this.events.sendToClient(ws, 'error', {
          message: 'Invalid message format',
          code: 'INVALID_MESSAGE'
        })
      }
    })

    ws.on('close', () => {
      this.handleDisconnection(ws)
    })

    ws.on('error', (error) => {
      logger.error('WebSocket client error', {
        clientId,
        error: error.message
      })
    })

    // Send periodic ping to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        this.events.sendToClient(ws, 'ping')
      } else {
        clearInterval(pingInterval)
      }
    }, 30000) // 30 seconds
  }

  /**
   * Handle incoming WebSocket messages
   */
  async handleMessage(ws, message) {
    const { type, ...data } = message

    logger.debug('WebSocket message received', {
      clientId: ws.clientId,
      type,
      data
    })

    switch (type) {
      case 'pong':
        // Response to our ping, nothing to do
        break

      case 'subscribe':
        await this.handleSubscribe(ws, data)
        break

      case 'unsubscribe':
        await this.handleUnsubscribe(ws, data)
        break

      case 'get_status':
        await this.handleGetStatus(ws)
        break

      case 'scan_projects':
        await this.handleScanProjects(ws, data)
        break

      case 'get_projects':
        await this.handleGetProjects(ws, data)
        break

      case 'get_approvals':
        await this.handleGetApprovals(ws, data)
        break

      case 'resolve_approval':
        await this.handleResolveApproval(ws, data)
        break

      case 'create_approval':
        await this.handleCreateApproval(ws, data)
        break

      case 'get_devices':
        await this.handleGetDevices(ws)
        break

      case 'get_sessions':
        await this.handleGetSessions(ws, data)
        break

      case 'create_session':
        await this.handleCreateSession(ws, data)
        break

      case 'terminal_command':
        await this.handleTerminalCommand(ws, data)
        break

      default:
        logger.warn('Unknown WebSocket message type', {
          clientId: ws.clientId,
          type
        })

        this.events.sendToClient(ws, 'error', {
          message: `Unknown message type: ${type}`,
          code: 'UNKNOWN_TYPE'
        })
    }
  }

  /**
   * Handle event subscription
   */
  async handleSubscribe(ws, { events }) {
    const clientSubscriptions = this.subscriptions.get(ws.clientId) || new Set()

    if (Array.isArray(events)) {
      events.forEach(event => clientSubscriptions.add(event))
    }

    this.subscriptions.set(ws.clientId, clientSubscriptions)

    this.events.sendToClient(ws, 'subscribed', {
      events: Array.from(clientSubscriptions)
    })

    logger.debug('Client subscribed to events', {
      clientId: ws.clientId,
      events: Array.from(clientSubscriptions)
    })
  }

  /**
   * Handle event unsubscription
   */
  async handleUnsubscribe(ws, { events }) {
    const clientSubscriptions = this.subscriptions.get(ws.clientId) || new Set()

    if (Array.isArray(events)) {
      events.forEach(event => clientSubscriptions.delete(event))
    }

    this.subscriptions.set(ws.clientId, clientSubscriptions)

    this.events.sendToClient(ws, 'unsubscribed', {
      events: Array.from(clientSubscriptions)
    })
  }

  /**
   * Handle status request
   */
  async handleGetStatus(ws) {
    const status = {
      daemon: {
        version: '0.1.0',
        https: true,
        url: 'https://navis.local:3415',
        uptime: process.uptime()
      },
      database: await this.repositories.settings.get('db_health') || { available: false },
      stats: this.events.getEventStats()
    }

    this.events.sendToClient(ws, 'status', status)
  }

  /**
   * Handle project scan request
   */
  async handleScanProjects(ws, { path, options = {} }) {
    try {
      // Start scan
      this.events.projectScanStarted(path, options)

      // Note: This would integrate with the discovery service
      // For now, send a placeholder response
      this.events.projectScanCompleted({
        count: 0,
        scannedPath: path,
        projects: []
      })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Scan failed: ${error.message}`,
        code: 'SCAN_FAILED'
      })
    }
  }

  /**
   * Handle get projects request
   */
  async handleGetProjects(ws, { limit = 50, offset = 0 }) {
    try {
      const projects = await this.repositories.projects.findAll({ limit, offset })

      this.events.sendToClient(ws, 'projects', {
        projects,
        total: projects.length
      })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Failed to get projects: ${error.message}`,
        code: 'GET_PROJECTS_FAILED'
      })
    }
  }

  /**
   * Handle get approvals request
   */
  async handleGetApprovals(ws, { status }) {
    try {
      const approvals = status === 'pending'
        ? await this.repositories.approvals.findPending()
        : await this.repositories.approvals.findAll({ status })

      this.events.sendToClient(ws, 'approvals', { approvals })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Failed to get approvals: ${error.message}`,
        code: 'GET_APPROVALS_FAILED'
      })
    }
  }

  /**
   * Handle approval resolution
   */
  async handleResolveApproval(ws, { id, action }) {
    try {
      if (!['approve', 'deny'].includes(action)) {
        throw new Error('Invalid action')
      }

      const approval = await this.repositories.approvals.resolve(
        id,
        action === 'approve' ? 'approved' : 'denied'
      )

      this.events.approvalResolved(approval)

      this.events.sendToClient(ws, 'approval_resolved', { approval })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Failed to resolve approval: ${error.message}`,
        code: 'RESOLVE_APPROVAL_FAILED'
      })
    }
  }

  /**
   * Handle approval creation
   */
  async handleCreateApproval(ws, { type, payload, projectId }) {
    try {
      const approval = await this.repositories.approvals.create({
        type,
        payload,
        projectId
      })

      this.events.approvalRequested(approval)

      this.events.sendToClient(ws, 'approval_created', { approval })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Failed to create approval: ${error.message}`,
        code: 'CREATE_APPROVAL_FAILED'
      })
    }
  }

  /**
   * Handle get devices request
   */
  async handleGetDevices(ws) {
    try {
      const devices = await this.repositories.devices.findAll()

      this.events.sendToClient(ws, 'devices', { devices })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Failed to get devices: ${error.message}`,
        code: 'GET_DEVICES_FAILED'
      })
    }
  }

  /**
   * Handle get sessions request
   */
  async handleGetSessions(ws, { projectId, type, activeOnly = true }) {
    try {
      const sessions = await this.repositories.sessions.findAll({
        projectId,
        type,
        activeOnly
      })

      this.events.sendToClient(ws, 'sessions', { sessions })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Failed to get sessions: ${error.message}`,
        code: 'GET_SESSIONS_FAILED'
      })
    }
  }

  /**
   * Handle session creation
   */
  async handleCreateSession(ws, { type, projectId }) {
    try {
      const session = await this.repositories.sessions.create({
        type,
        projectId
      })

      this.events.sessionStarted(session)

      this.events.sendToClient(ws, 'session_created', { session })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Failed to create session: ${error.message}`,
        code: 'CREATE_SESSION_FAILED'
      })
    }
  }

  /**
   * Handle terminal command (requires approval)
   */
  async handleTerminalCommand(ws, { sessionId, command }) {
    try {
      // Create approval for terminal command
      const approval = await this.repositories.approvals.create({
        type: 'terminal_command',
        payload: { sessionId, command },
        projectId: null // Terminal commands might not be project-specific
      })

      this.events.terminalCommand(sessionId, command)
      this.events.approvalRequested(approval)

      this.events.sendToClient(ws, 'terminal_command_queued', {
        sessionId,
        command,
        approvalId: approval.id
      })
    } catch (error) {
      this.events.sendToClient(ws, 'error', {
        message: `Failed to queue terminal command: ${error.message}`,
        code: 'QUEUE_COMMAND_FAILED'
      })
    }
  }

  /**
   * Handle client disconnection
   */
  handleDisconnection(ws) {
    logger.info('WebSocket client disconnected', {
      clientId: ws.clientId
    })

    // Clean up subscriptions
    this.subscriptions.delete(ws.clientId)
  }

  /**
   * Generate a unique client ID
   */
  generateClientId() {
    return 'client_' + Date.now().toString(36) + Math.random().toString(36).substr(2)
  }
}

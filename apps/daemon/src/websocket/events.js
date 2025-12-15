/**
 * Navis Daemon WebSocket Events System
 * Handles real-time event broadcasting to connected clients
 */

import { logger } from '@navisai/logging'

export class WebSocketEvents {
  constructor(wss) {
    this.wss = wss
    this.eventCounters = new Map()
  }

  /**
   * Broadcast an event to all connected WebSocket clients
   */
  broadcast(event, data = {}) {
    if (!this.wss) {
      logger.warn('WebSocket server not available for broadcasting')
      return
    }

    const message = JSON.stringify({
      type: event,
      timestamp: new Date().toISOString(),
      ...data
    })

    let clientCount = 0
    this.wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message)
        clientCount++
      }
    })

    // Track event statistics
    const count = this.eventCounters.get(event) || 0
    this.eventCounters.set(event, count + 1)

    logger.debug('WebSocket event broadcasted', {
      event,
      clientCount,
      totalSent: count + 1
    })

    return clientCount
  }

  /**
   * Send event to specific client
   */
  sendToClient(ws, event, data = {}) {
    if (ws.readyState !== ws.OPEN) {
      return false
    }

    const message = JSON.stringify({
      type: event,
      timestamp: new Date().toISOString(),
      ...data
    })

    ws.send(message)
    return true
  }

  // Specific event methods for common events

  /**
   * Project discovery events
   */
  projectDiscovered(project) {
    return this.broadcast('project_discovered', {
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        classification: project.classification?.primary?.name,
        detectedAt: project.detectedAt
      }
    })
  }

  projectScanStarted(scanPath, options = {}) {
    return this.broadcast('scan_started', {
      scanPath,
      options
    })
  }

  projectScanCompleted(results) {
    return this.broadcast('scan_completed', {
      results: {
        count: results.projects?.length || 0,
        scannedPath: results.scannedPath,
        projects: results.projects?.map(p => ({
          id: p.id,
          name: p.name,
          path: p.path,
          classification: p.classification?.primary?.name,
          detectedAt: p.detectedAt
        })) || []
      }
    })
  }

  /**
   * Approval events
   */
  approvalRequested(approval) {
    return this.broadcast('approval_requested', {
      approval: {
        id: approval.id,
        type: approval.type,
        projectId: approval.projectId,
        payload: approval.payload,
        createdAt: approval.createdAt
      }
    })
  }

  approvalResolved(approval) {
    return this.broadcast('approval_resolved', {
      approval: {
        id: approval.id,
        status: approval.status,
        resolvedAt: approval.resolvedAt
      }
    })
  }

  /**
   * Device events
   */
  devicePaired(device) {
    return this.broadcast('device_paired', {
      device: {
        id: device.id,
        name: device.name,
        pairedAt: device.pairedAt
      }
    })
  }

  deviceUnpaired(deviceId) {
    return this.broadcast('device_unpaired', {
      deviceId
    })
  }

  deviceRevoked(deviceId) {
    return this.broadcast('device_revoked', {
      deviceId
    })
  }

  /**
   * Session events
   */
  sessionStarted(session) {
    return this.broadcast('session_started', {
      session: {
        id: session.id,
        type: session.type,
        projectId: session.projectId,
        createdAt: session.createdAt
      }
    })
  }

  sessionUpdated(session) {
    return this.broadcast('session_updated', {
      session: {
        id: session.id,
        type: session.type,
        updatedAt: session.updatedAt
      }
    })
  }

  sessionEnded(sessionId) {
    return this.broadcast('session_ended', {
      sessionId
    })
  }

  /**
   * Terminal events
   */
  terminalOutput(sessionId, output) {
    return this.broadcast('terminal_output', {
      sessionId,
      output: output.slice(-1000), // Limit last 1000 chars
      timestamp: new Date().toISOString()
    })
  }

  terminalCommand(sessionId, command) {
    return this.broadcast('terminal_command', {
      sessionId,
      command,
      awaitingApproval: true
    })
  }

  terminalCommandApproved(sessionId, command) {
    return this.broadcast('terminal_command_approved', {
      sessionId,
      command,
      executedAt: new Date().toISOString()
    })
  }

  terminalCommandDenied(sessionId, command) {
    return this.broadcast('terminal_command_denied', {
      sessionId,
      command,
      deniedAt: new Date().toISOString()
    })
  }

  /**
   * ACP (Agent Control Protocol) events
   */
  acpSessionStarted(session) {
    return this.broadcast('acp_session_started', {
      session: {
        id: session.id,
        projectId: session.projectId,
        agentId: session.agentId,
        startedAt: session.createdAt
      }
    })
  }

  acpAction(sessionId, action) {
    return this.broadcast('acp_action', {
      sessionId,
      action,
      awaitingApproval: true
    })
  }

  acpActionApproved(sessionId, action) {
    return this.broadcast('acp_action_approved', {
      sessionId,
      action,
      executedAt: new Date().toISOString()
    })
  }

  acpActionDenied(sessionId, action) {
    return this.broadcast('acp_action_denied', {
      sessionId,
      action,
      deniedAt: new Date().toISOString()
    })
  }

  /**
   * System events
   */
  daemonStarted(config = {}) {
    return this.broadcast('daemon_started', {
      version: '0.1.0',
      https: true,
      url: config.url || 'https://navis.local:3415',
      startedAt: new Date().toISOString()
    })
  }

  daemonStopped() {
    return this.broadcast('daemon_stopped', {
      stoppedAt: new Date().toISOString()
    })
  }

  statusUpdate(status) {
    return this.broadcast('status_update', {
      status
    })
  }

  /**
   * Get event statistics
   */
  getEventStats() {
    return {
      connectedClients: this.wss ? this.wss.clients.size : 0,
      eventCounts: Object.fromEntries(this.eventCounters)
    }
  }

  /**
   * Reset event counters
   */
  resetStats() {
    this.eventCounters.clear()
  }
}

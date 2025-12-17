/**
 * Log Store for Real-time Log Streaming
 * Captures and buffers logs for streaming to CLI
 */

import { EventEmitter } from 'node:events'

export class LogStore extends EventEmitter {
  constructor(options = {}) {
    super()
    this.maxBuffer = options.maxBuffer || 1000
    this.buffer = []
    this.clients = new Set()
  }

  addLog(logEntry) {
    const entry = {
      ...logEntry,
      id: this.generateId(),
      timestamp: logEntry.timestamp || new Date().toISOString()
    }

    // Add to circular buffer
    this.buffer.push(entry)
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift()
    }

    // Emit to all connected clients
    this.emit('log', entry)
  }

  getRecentLogs(count = 100) {
    return this.buffer.slice(-count)
  }

  addClient(res) {
    this.clients.add(res)

    // Send recent logs on connect
    const recent = this.getRecentLogs(100)
    recent.forEach(log => {
      this.sendToClient(res, log)
    })

    // Listen for new logs and forward to this client
    const onLog = (log) => {
      this.sendToClient(res, log)
    }
    this.on('log', onLog)

    // Handle client disconnect
    res.on('close', () => {
      this.clients.delete(res)
      this.off('log', onLog)
    })
  }

  sendToClient(res, log) {
    try {
      res.write(`data: ${JSON.stringify(log)}\n\n`)
    } catch (error) {
      // Client disconnected, remove from set
      this.clients.delete(res)
    }
  }

  broadcast(log) {
    for (const res of this.clients) {
      this.sendToClient(res, log)
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }
}

// Create singleton instance
export const logStore = new LogStore()

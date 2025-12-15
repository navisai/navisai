/**
 * Session Service
 * Manages active sessions (terminal, ACP, etc.)
 */

export class SessionService {
  constructor() {
    this.sessions = new Map()
  }

  async initialize() {
    console.log('💻 Session service initialized')
  }

  async listSessions() {
    return {
      sessions: Array.from(this.sessions.values()).map(session => ({
        id: session.id,
        type: session.type,
        status: session.status,
        startTime: session.startTime,
        lastActivity: session.lastActivity
      }))
    }
  }

  async createSession(type, metadata = {}) {
    const session = {
      id: this.generateId(),
      type, // 'terminal', 'acp', etc.
      status: 'active',
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      ...metadata
    }

    this.sessions.set(session.id, session)
    return session
  }

  async getSession(id) {
    const session = this.sessions.get(id)
    if (!session) {
      throw new Error('Session not found')
    }
    return session
  }

  async updateSession(id, updates) {
    const session = this.sessions.get(id)
    if (!session) {
      throw new Error('Session not found')
    }

    Object.assign(session, updates, {
      lastActivity: new Date().toISOString()
    })

    this.sessions.set(id, session)
    return session
  }

  async closeSession(id) {
    const session = this.sessions.get(id)
    if (!session) {
      throw new Error('Session not found')
    }

    session.status = 'closed'
    session.endTime = new Date().toISOString()
    this.sessions.set(id, session)

    return session
  }

  generateId() {
    return 'session_' + Math.random().toString(36).substr(2, 9)
  }
}

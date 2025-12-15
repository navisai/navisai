/**
 * Navis AI Database Repositories
 * High-level data access methods for each entity type
 */

import { eq, and, desc, gt, lte, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { logger } from '@navisai/logging'

// Import schema (will be available when dbManager initializes)
let schema
let dbManager

// Initialize when dbManager is available
async function getDB() {
  if (!dbManager) {
    dbManager = (await import('./index.js')).dbManager
    schema = (await import('./schema.js')).schema
  }
  return dbManager.db
}

export class ProjectsRepository {
  async findAll(options = {}) {
    const { limit = 100, offset = 0, orderBy = 'updatedAt' } = options
    const db = await getDB()

    try {
      const projects = await db
        .select()
        .from(schema.projects)
        .limit(limit)
        .offset(offset)
        .orderBy(desc(schema.projects[orderBy] || schema.projects.updatedAt))

      return projects
    } catch (error) {
      logger.error('Failed to find projects', { error: error.message })
      throw error
    }
  }

  async findById(id) {
    const db = await getDB()

    try {
      const project = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, id))
        .limit(1)

      return project[0] || null
    } catch (error) {
      logger.error('Failed to find project by ID', { id, error: error.message })
      throw error
    }
  }

  async findByPath(path) {
    const db = await getDB()

    try {
      const project = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.path, path))
        .limit(1)

      return project[0] || null
    } catch (error) {
      logger.error('Failed to find project by path', { path, error: error.message })
      throw error
    }
  }

  async create(data) {
    const db = await getDB()
    const id = data.id || nanoid()
    const now = new Date().toISOString()

    try {
      const project = {
        id,
        name: data.name,
        path: data.path,
        createdAt: now,
        updatedAt: now
      }

      await db.insert(schema.projects).values(project)
      return this.findById(id)
    } catch (error) {
      logger.error('Failed to create project', { data, error: error.message })
      throw error
    }
  }

  async upsert(data) {
    const db = await getDB()
    const now = new Date().toISOString()

    try {
      const existing = await this.findByPath(data.path)

      if (existing) {
        // Update existing project
        await db
          .update(schema.projects)
          .set({
            name: data.name || existing.name,
            updatedAt: now
          })
          .where(eq(schema.projects.id, existing.id))

        return this.findById(existing.id)
      } else {
        // Create new project
        return this.create(data)
      }
    } catch (error) {
      logger.error('Failed to upsert project', { data, error: error.message })
      throw error
    }
  }

  async delete(id) {
    const db = await getDB()

    try {
      await db.delete(schema.projects).where(eq(schema.projects.id, id))
      return true
    } catch (error) {
      logger.error('Failed to delete project', { id, error: error.message })
      throw error
    }
  }

  async update(id, data) {
    const db = await getDB()
    const now = new Date().toISOString()

    try {
      await db
        .update(schema.projects)
        .set({
          ...data,
          updatedAt: now
        })
        .where(eq(schema.projects.id, id))

      return this.findById(id)
    } catch (error) {
      logger.error('Failed to update project', { id, data, error: error.message })
      throw error
    }
  }
}

export class DevicesRepository {
  async findAll(options = {}) {
    const { includeRevoked = false } = options
    const db = await getDB()

    try {
      let query = db.select().from(schema.devices)

      if (!includeRevoked) {
        query = query.where(eq(schema.devices.isRevoked, 0))
      }

      const devices = await query.orderBy(desc(schema.devices.lastSeenAt))
      return devices
    } catch (error) {
      logger.error('Failed to find devices', { error: error.message })
      throw error
    }
  }

  async findById(id) {
    const db = await getDB()

    try {
      const device = await db
        .select()
        .from(schema.devices)
        .where(eq(schema.devices.id, id))
        .limit(1)

      return device[0] || null
    } catch (error) {
      logger.error('Failed to find device by ID', { id, error: error.message })
      throw error
    }
  }

  async create(data) {
    const db = await getDB()
    const id = data.id || nanoid()
    const now = new Date().toISOString()

    try {
      const device = {
        id,
        name: data.name,
        publicKey: data.publicKey,
        pairedAt: now,
        lastSeenAt: now,
        isRevoked: 0
      }

      await db.insert(schema.devices).values(device)
      return this.findById(id)
    } catch (error) {
      logger.error('Failed to create device', { data, error: error.message })
      throw error
    }
  }

  async updateLastSeen(id) {
    const db = await getDB()
    const now = new Date().toISOString()

    try {
      await db
        .update(schema.devices)
        .set({ lastSeenAt: now })
        .where(eq(schema.devices.id, id))

      return this.findById(id)
    } catch (error) {
      logger.error('Failed to update device last seen', { id, error: error.message })
      throw error
    }
  }

  async revoke(id) {
    const db = await getDB()

    try {
      await db
        .update(schema.devices)
        .set({ isRevoked: 1 })
        .where(eq(schema.devices.id, id))

      return this.findById(id)
    } catch (error) {
      logger.error('Failed to revoke device', { id, error: error.message })
      throw error
    }
  }
}

export class ApprovalsRepository {
  async findAll(options = {}) {
    const { status, limit = 100, offset = 0 } = options
    const db = await getDB()

    try {
      let query = db.select().from(schema.approvals)

      if (status) {
        query = query.where(eq(schema.approvals.status, status))
      }

      const approvals = await query
        .limit(limit)
        .offset(offset)
        .orderBy(desc(schema.approvals.createdAt))

      return approvals
    } catch (error) {
      logger.error('Failed to find approvals', { error: error.message })
      throw error
    }
  }

  async findPending() {
    const db = await getDB()

    try {
      const approvals = await db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.status, 'pending'))
        .orderBy(desc(schema.approvals.createdAt))

      return approvals
    } catch (error) {
      logger.error('Failed to find pending approvals', { error: error.message })
      throw error
    }
  }

  async findById(id) {
    const db = await getDB()

    try {
      const approval = await db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.id, id))
        .limit(1)

      return approval[0] || null
    } catch (error) {
      logger.error('Failed to find approval by ID', { id, error: error.message })
      throw error
    }
  }

  async create(data) {
    const db = await getDB()
    const id = data.id || nanoid()
    const now = new Date().toISOString()

    try {
      const approval = {
        id,
        projectId: data.projectId || null,
        type: data.type,
        payload: JSON.stringify(data.payload || {}),
        status: 'pending',
        createdAt: now
      }

      await db.insert(schema.approvals).values(approval)
      return this.findById(id)
    } catch (error) {
      logger.error('Failed to create approval', { data, error: error.message })
      throw error
    }
  }

  async resolve(id, newStatus) {
    const db = await getDB()
    const now = new Date().toISOString()

    if (!['approved', 'denied'].includes(newStatus)) {
      throw new Error('Invalid resolution status')
    }

    try {
      await db
        .update(schema.approvals)
        .set({
          status: newStatus,
          resolvedAt: now
        })
        .where(eq(schema.approvals.id, id))

      return this.findById(id)
    } catch (error) {
      logger.error('Failed to resolve approval', { id, newStatus, error: error.message })
      throw error
    }
  }
}

export class SessionsRepository {
  async findAll(options = {}) {
    const { projectId, type, activeOnly = false } = options
    const db = await getDB()

    try {
      let query = db.select().from(schema.sessions)

      if (projectId) {
        query = query.where(eq(schema.sessions.projectId, projectId))
      }

      if (type) {
        query = query.where(eq(schema.sessions.type, type))
      }

      if (activeOnly) {
        // Consider sessions active if updated in last 5 minutes
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        query = query.where(gt(schema.sessions.updatedAt, fiveMinutesAgo))
      }

      const sessions = await query.orderBy(desc(schema.sessions.updatedAt))
      return sessions
    } catch (error) {
      logger.error('Failed to find sessions', { error: error.message })
      throw error
    }
  }

  async findById(id) {
    const db = await getDB()

    try {
      const session = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .limit(1)

      return session[0] || null
    } catch (error) {
      logger.error('Failed to find session by ID', { id, error: error.message })
      throw error
    }
  }

  async create(data) {
    const db = await getDB()
    const id = data.id || nanoid()
    const now = new Date().toISOString()

    try {
      const session = {
        id,
        projectId: data.projectId || null,
        type: data.type,
        createdAt: now,
        updatedAt: now
      }

      await db.insert(schema.sessions).values(session)
      return this.findById(id)
    } catch (error) {
      logger.error('Failed to create session', { data, error: error.message })
      throw error
    }
  }

  async updateActivity(id) {
    const db = await getDB()
    const now = new Date().toISOString()

    try {
      await db
        .update(schema.sessions)
        .set({ updatedAt: now })
        .where(eq(schema.sessions.id, id))

      return this.findById(id)
    } catch (error) {
      logger.error('Failed to update session activity', { id, error: error.message })
      throw error
    }
  }

  async delete(id) {
    const db = await getDB()

    try {
      await db.delete(schema.sessions).where(eq(schema.sessions.id, id))
      return true
    } catch (error) {
      logger.error('Failed to delete session', { id, error: error.message })
      throw error
    }
  }
}

export class SettingsRepository {
  async get(key) {
    const db = await getDB()

    try {
      const setting = await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, key))
        .limit(1)

      return setting[0] ? JSON.parse(setting[0].value) : null
    } catch (error) {
      logger.error('Failed to get setting', { key, error: error.message })
      throw error
    }
  }

  async set(key, value) {
    const db = await getDB()
    const now = new Date().toISOString()

    try {
      await db.insert(schema.settings).values({
        key,
        value: JSON.stringify(value),
        updatedAt: now
      }).onConflictDoUpdate({
        target: schema.settings.key,
        set: {
          value: JSON.stringify(value),
          updatedAt: now
        }
      })

      return this.get(key)
    } catch (error) {
      logger.error('Failed to set setting', { key, value, error: error.message })
      throw error
    }
  }

  async getAll() {
    const db = await getDB()

    try {
      const settings = await db.select().from(schema.settings)

      const result = {}
      for (const setting of settings) {
        try {
          result[setting.key] = JSON.parse(setting.value)
        } catch {
          result[setting.key] = setting.value
        }
      }

      return result
    } catch (error) {
      logger.error('Failed to get all settings', { error: error.message })
      throw error
    }
  }
}

// Export repository instances
export const projectsRepo = new ProjectsRepository()
export const devicesRepo = new DevicesRepository()
export const approvalsRepo = new ApprovalsRepository()
export const sessionsRepo = new SessionsRepository()
export const settingsRepo = new SettingsRepository()

import { eq, and, desc, asc } from 'drizzle-orm'
import dbManager from './index.js'
import {
  projects,
  projectSignals,
  projectClassification,
  devices,
  approvals,
  sessions,
  settings
} from './schema.js'

export class ProjectsRepository {
  constructor(db = dbManager) {
    this.db = db
  }

  async create(data) {
    if (!this.db.isAvailable()) {
      throw new Error('Database not available')
    }
    const client = this.db.getClient()
    const [project] = await client
      .insert(projects)
      .values({
        id: crypto.randomUUID(),
        ...data,
        createdAt: new Date().toISOString(),
      })
      .returning()
    return project
  }

  async findByPath(path) {
    const client = this.db.getClient()
    const [project] = await client
      .select()
      .from(projects)
      .where(eq(projects.path, path))
      .limit(1)
    return project
  }

  async findById(id) {
    const client = this.db.getClient()
    const [project] = await client
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1)
    return project
  }

  async findAll() {
    const client = this.db.getClient()
    return await client
      .select()
      .from(projects)
      .orderBy(desc(projects.updatedAt))
  }

  async update(id, data) {
    const client = this.db.getClient()
    const [project] = await client
      .update(projects)
      .set({
        ...data,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, id))
      .returning()
    return project
  }

  async delete(id) {
    const client = this.db.getClient()
    return await client
      .delete(projects)
      .where(eq(projects.id, id))
  }
}

export class DevicesRepository {
  constructor(db = dbManager) {
    this.db = db
  }

  async create(data) {
    const client = this.db.getClient()
    const [device] = await client
      .insert(devices)
      .values({
        id: crypto.randomUUID(),
        pairedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        ...data,
      })
      .returning()
    return device
  }

  async findById(id) {
    const client = this.db.getClient()
    const [device] = await client
      .select()
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.isRevoked, false)))
      .limit(1)
    return device
  }

  async findAll() {
    const client = this.db.getClient()
    return await client
      .select()
      .from(devices)
      .where(eq(devices.isRevoked, false))
      .orderBy(desc(devices.lastSeenAt))
  }

  async updateLastSeen(id) {
    const client = this.db.getClient()
    const [device] = await client
      .update(devices)
      .set({
        lastSeenAt: new Date().toISOString(),
      })
      .where(eq(devices.id, id))
      .returning()
    return device
  }

  async revoke(id) {
    const client = this.db.getClient()
    const [device] = await client
      .update(devices)
      .set({
        isRevoked: true,
      })
      .where(eq(devices.id, id))
      .returning()
    return device
  }
}

export class ApprovalsRepository {
  constructor(db = dbManager) {
    this.db = db
  }

  async create(data) {
    const client = this.db.getClient()
    const [approval] = await client
      .insert(approvals)
      .values({
        id: crypto.randomUUID(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...data,
      })
      .returning()
    return approval
  }

  async findById(id) {
    const client = this.db.getClient()
    const [approval] = await client
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .limit(1)
    return approval
  }

  async findPending() {
    const client = this.db.getClient()
    return await client
      .select()
      .from(approvals)
      .where(eq(approvals.status, 'pending'))
      .orderBy(asc(approvals.createdAt))
  }

  async resolve(id, status) {
    const client = this.db.getClient()
    const [approval] = await client
      .update(approvals)
      .set({
        status,
        resolvedAt: new Date().toISOString(),
      })
      .where(eq(approvals.id, id))
      .returning()
    return approval
  }
}

export class SettingsRepository {
  constructor(db = dbManager) {
    this.db = db
  }

  async get(key) {
    const client = this.db.getClient()
    const [setting] = await client
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1)
    return setting?.value
  }

  async set(key, value) {
    const client = this.db.getClient()
    await client
      .insert(settings)
      .values({
        key,
        value,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value,
          updatedAt: new Date().toISOString(),
        },
      })
  }

  async getAll() {
    const client = this.db.getClient()
    const allSettings = await client
      .select()
      .from(settings)

    return allSettings.reduce((acc, setting) => {
      acc[setting.key] = setting.value
      return acc
    }, {})
  }
}

// Export all repositories
export const projectsRepo = new ProjectsRepository()
export const devicesRepo = new DevicesRepository()
export const approvalsRepo = new ApprovalsRepository()
export const settingsRepo = new SettingsRepository()

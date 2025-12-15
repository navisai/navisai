import { eq, desc, and, isNull, or } from 'drizzle-orm'
import { projects, projectSignals, projectClassification } from '../schema.js'

/**
 * Repository for managing projects
 */
export class ProjectsRepository {
  constructor(db) {
    this.db = db.getClient()
  }

  /**
   * Create a new project
   * @param {Object} data - Project data
   * @param {string} data.id - Project ID
   * @param {string} data.path - Project path
   * @param {string} [data.name] - Project name
   * @returns {Promise<Object>} Created project
   */
  async create(data) {
    const now = new Date().toISOString()

    const [project] = await this.db.insert(projects).values({
      ...data,
      createdAt: now,
      updatedAt: now,
    }).returning()

    return project
  }

  /**
   * Get project by ID
   * @param {string} id - Project ID
   * @returns {Promise<Object|null>} Project or null
   */
  async findById(id) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1)

    return project || null
  }

  /**
   * Get project by path
   * @param {string} path - Project path
   * @returns {Promise<Object|null>} Project or null
   */
  async findByPath(path) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.path, path))
      .limit(1)

    return project || null
  }

  /**
   * Get all projects
   * @param {Object} [options] - Query options
   * @param {number} [options.limit] - Limit results
   * @param {number} [options.offset] - Offset results
   * @returns {Promise<Array>} List of projects
   */
  async findAll(options = {}) {
    const { limit = 100, offset = 0 } = options

    return await this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.updatedAt))
      .limit(limit)
      .offset(offset)
  }

  /**
   * Update project
   * @param {string} id - Project ID
   * @param {Object} data - Update data
   * @returns {Promise<Object|null>} Updated project or null
   */
  async update(id, data) {
    const [project] = await this.db
      .update(projects)
      .set({
        ...data,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, id))
      .returning()

    return project || null
  }

  /**
   * Delete project
   * @param {string} id - Project ID
   * @returns {Promise<boolean>} True if deleted
   */
  async delete(id) {
    const result = await this.db
      .delete(projects)
      .where(eq(projects.id, id))

    return result.changes > 0
  }

  /**
   * Get project with all related data
   * @param {string} id - Project ID
   * @returns {Promise<Object|null>} Project with signals and classification
   */
  async findByIdWithDetails(id) {
    const project = await this.findById(id)
    if (!project) return null

    // Get signals
    const signals = await this.db
      .select()
      .from(projectSignals)
      .where(eq(projectSignals.projectId, id))

    // Get classification
    const [classification] = await this.db
      .select()
      .from(projectClassification)
      .where(eq(projectClassification.projectId, id))

    return {
      ...project,
      signals,
      classification: classification || null,
    }
  }

  /**
   * Add signal to project
   * @param {string} projectId - Project ID
   * @param {Object} signal - Signal data
   * @returns {Promise<Object>} Created signal
   */
  async addSignal(projectId, signal) {
    const [createdSignal] = await this.db
      .insert(projectSignals)
      .values({
        id: crypto.randomUUID(),
        projectId,
        ...signal,
      })
      .returning()

    return createdSignal
  }

  /**
   * Update project classification
   * @param {string} projectId - Project ID
   * @param {Object} classification - Classification data
   * @returns {Promise<Object>} Updated classification
   */
  async updateClassification(projectId, classification) {
    const data = {
      categories: classification.categories ? JSON.stringify(classification.categories) : null,
      frameworks: classification.frameworks ? JSON.stringify(classification.frameworks) : null,
      languages: classification.languages ? JSON.stringify(classification.languages) : null,
      confidence: classification.confidence,
      metadata: classification.metadata ? JSON.stringify(classification.metadata) : null,
    }

    const [updated] = await this.db
      .insert(projectClassification)
      .values({ projectId, ...data })
      .onConflictDoUpdate({
        target: projectClassification.projectId,
        set: data,
      })
      .returning()

    // Parse JSON fields for returning
    return {
      ...updated,
      categories: updated.categories ? JSON.parse(updated.categories) : null,
      frameworks: updated.frameworks ? JSON.parse(updated.frameworks) : null,
      languages: updated.languages ? JSON.parse(updated.languages) : null,
      metadata: updated.metadata ? JSON.parse(updated.metadata) : null,
    }
  }

  /**
   * Search projects by name or path
   * @param {string} query - Search query
   * @returns {Promise<Array>} Matching projects
   */
  async search(query) {
    const lowerQuery = `%${query.toLowerCase()}%`

    return await this.db
      .select()
      .from(projects)
      .where(
        or(
          // SQLite doesn't have ILIKE, so use LOWER
          sql`LOWER(${projects.name}) LIKE ${lowerQuery}`,
          sql`LOWER(${projects.path}) LIKE ${lowerQuery}`
        )
      )
      .orderBy(desc(projects.updatedAt))
  }
}

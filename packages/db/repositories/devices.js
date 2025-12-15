import { eq, and, isNull } from 'drizzle-orm'
import { devices } from '../schema.js'

/**
 * Repository for managing paired devices
 */
export class DevicesRepository {
  constructor(db) {
    this.db = db.getClient()
  }

  /**
   * Create a new device
   * @param {Object} data - Device data
   * @returns {Promise<Object>} Created device
   */
  async create(data) {
    const now = new Date().toISOString()

    const [device] = await this.db.insert(devices).values({
      ...data,
      pairedAt: now,
      lastSeenAt: now,
    }).returning()

    return device
  }

  /**
   * Get device by ID
   * @param {string} id - Device ID
   * @returns {Promise<Object|null>} Device or null
   */
  async findById(id) {
    const [device] = await this.db
      .select()
      .from(devices)
      .where(eq(devices.id, id))
      .limit(1)

    return device || null
  }

  /**
   * Get all active (non-revoked) devices
   * @returns {Promise<Array>} List of active devices
   */
  async findAllActive() {
    return await this.db
      .select()
      .from(devices)
      .where(eq(devices.isRevoked, false))
      .orderBy(devices.lastSeenAt)
  }

  /**
   * Update device last seen timestamp
   * @param {string} id - Device ID
   * @returns {Promise<boolean>} True if updated
   */
  async updateLastSeen(id) {
    const result = await this.db
      .update(devices)
      .set({
        lastSeenAt: new Date().toISOString(),
      })
      .where(eq(devices.id, id))

    return result.changes > 0
  }

  /**
   * Revoke device access
   * @param {string} id - Device ID
   * @returns {Promise<boolean>} True if revoked
   */
  async revoke(id) {
    const result = await this.db
      .update(devices)
      .set({
        isRevoked: true,
      })
      .where(eq(devices.id, id))

    return result.changes > 0
  }

  /**
   * Delete device completely
   * @param {string} id - Device ID
   * @returns {Promise<boolean>} True if deleted
   */
  async delete(id) {
    const result = await this.db
      .delete(devices)
      .where(eq(devices.id, id))

    return result.changes > 0
  }

  /**
   * Check if device is trusted
   * @param {string} id - Device ID
   * @returns {Promise<boolean>} True if trusted
   */
  async isTrusted(id) {
    const device = await this.findById(id)
    return device ? !device.isRevoked : false
  }

  /**
   * Get device by public key
   * @param {string} publicKey - Device public key
   * @returns {Promise<Object|null>} Device or null
   */
  async findByPublicKey(publicKey) {
    const [device] = await this.db
      .select()
      .from(devices)
      .where(eq(devices.publicKey, publicKey))
      .limit(1)

    return device || null
  }
}

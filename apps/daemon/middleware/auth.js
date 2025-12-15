/**
 * Authentication Middleware
 * Implements HMAC-based request signing as per AUTH_MODEL.md
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000 // 5 minutes
const NONCE_CACHE = new Map() // Simple replay protection

/**
 * Parse Authorization header
 * Format: Navis deviceId="<id>",signature="<base64>",timestamp="<iso8601>"
 */
function parseAuthHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith('Navis ')) {
    return null
  }

  const authPart = authHeader.slice(6) // Remove 'Navis '
  const parts = authPart.split(',')

  const result = {}
  for (const part of parts) {
    const [key, ...valueParts] = part.split('=')
    if (valueParts.length === 0) continue

    let value = valueParts.join('=')
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }

    result[key.trim()] = value
  }

  if (!result.deviceId || !result.signature || !result.timestamp) {
    return null
  }

  return result
}

/**
 * Create canonical string for HMAC
 */
function createCanonicalString(method, path, bodyHash, timestamp) {
  return `${method}\n${path}\n${bodyHash}\n${timestamp}`
}

/**
 * Compute body hash
 */
function computeBodyHash(body) {
  if (!body || body === '') {
    return ''
  }
  return createHash('sha256').update(body).digest('hex')
}

/**
 * Verify HMAC signature
 */
function verifySignature(canonicalString, signature, deviceSecret) {
  try {
    const expectedSignature = createHmac('sha256', deviceSecret)
      .update(canonicalString)
      .digest('base64')

    // Constant-time comparison
    const expectedBuf = Buffer.from(expectedSignature, 'base64')
    const actualBuf = Buffer.from(signature, 'base64')

    if (expectedBuf.length !== actualBuf.length) {
      return false
    }

    return timingSafeEqual(expectedBuf, actualBuf)
  } catch (error) {
    return false
  }
}

/**
 * Check for replay attacks
 */
function checkReplay(deviceId, signature, timestamp) {
  const key = `${deviceId}:${signature}`
  const existing = NONCE_CACHE.get(key)

  if (existing && (timestamp - existing) < MAX_TIMESTAMP_SKEW_MS) {
    return false // Replay detected
  }

  NONCE_CACHE.set(key, timestamp)

  // Clean old entries
  const cutoff = Date.now() - MAX_TIMESTAMP_SKEW_MS * 2
  for (const [cacheKey, cacheTime] of NONCE_CACHE.entries()) {
    if (cacheTime < cutoff) {
      NONCE_CACHE.delete(cacheKey)
    }
  }

  return true
}

/**
 * Authentication middleware factory
 */
export function createAuthMiddleware(dbManager) {
  return async function authMiddleware(request, reply) {
    const protectedPrefixes = [
      '/projects',
      '/sessions',
      '/approvals',
      '/devices',
      '/discovery',
      '/logs',
    ]

    if (!protectedPrefixes.some(prefix => request.url.startsWith(prefix))) {
      return
    }

    // Parse Authorization header
    const authHeader = request.headers.authorization
    const auth = parseAuthHeader(authHeader)

    if (!auth) {
      reply.code(401).send({
        error: 'Invalid or missing authorization header',
        code: 'INVALID_AUTH_HEADER'
      })
      return reply.hijack()
    }

    const { deviceId, signature, timestamp } = auth

    // Validate timestamp
    const requestTime = new Date(timestamp).getTime()
    const now = Date.now()

    if (isNaN(requestTime) || Math.abs(now - requestTime) > MAX_TIMESTAMP_SKEW_MS) {
      reply.code(401).send({
        error: 'Timestamp outside valid range',
        code: 'INVALID_TIMESTAMP'
      })
      return reply.hijack()
    }

    try {
      // Look up device in database
      const device = await dbManager.query(
        'SELECT id, secretHash, isRevoked FROM devices WHERE id = ?',
        [deviceId]
      )

      if (!device || device.length === 0) {
        reply.code(401).send({
          error: 'Device not found',
          code: 'DEVICE_NOT_FOUND'
        })
        return reply.hijack()
      }

      if (device[0].isRevoked) {
        reply.code(401).send({
          error: 'Device has been revoked',
          code: 'DEVICE_REVOKED'
        })
        return reply.hijack()
      }

      // For MVP, we'll assume the secretHash is actually the raw secret
      // In production, this should be a proper hash
      const deviceSecret = device[0].secretHash

      // Compute canonical string
      const method = request.method
      const url = new URL(request.url, `https://${request.headers.host}`)
      const path = url.pathname + url.search
      const body = request.body || ''
      const bodyHash = computeBodyHash(typeof body === 'string' ? body : JSON.stringify(body))
      const canonicalString = createCanonicalString(method, path, bodyHash, timestamp)

      // Verify signature
      if (!verifySignature(canonicalString, signature, deviceSecret)) {
        reply.code(401).send({
          error: 'Invalid signature',
          code: 'INVALID_SIGNATURE'
        })
        return reply.hijack()
      }

      // Check for replay
      if (!checkReplay(deviceId, signature, requestTime)) {
        reply.code(401).send({
          error: 'Replay detected',
          code: 'REPLAY_DETECTED'
        })
        return reply.hijack()
      }

      // Attach device info to request
      request.device = {
        id: deviceId,
        authenticated: true
      }

      // Update last seen
      await dbManager.execute(
        'UPDATE devices SET lastSeenAt = ? WHERE id = ?',
        [new Date().toISOString(), deviceId]
      )

    } catch (error) {
      console.error('Authentication error:', error)
      reply.code(500).send({
        error: 'Internal authentication error',
        code: 'INTERNAL_ERROR'
      })
      return reply.hijack()
    }
  }
}

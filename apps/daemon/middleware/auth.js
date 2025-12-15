import {
  parseAuthHeader,
  createCanonicalString,
  computeBodyHash,
  verifySignature,
  checkReplay,
  isTimestampValid,
} from '../auth/utils.js'

/**
 * Authentication Middleware
 * Implements HMAC-based request signing as per AUTH_MODEL.md
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

    const auth = parseAuthHeader(request.headers.authorization)
    if (!auth) {
      reply.code(401).send({
        error: 'Invalid or missing authorization header',
        code: 'INVALID_AUTH_HEADER'
      })
      return reply.hijack()
    }

    const { deviceId, signature, timestamp } = auth
    if (!isTimestampValid(timestamp)) {
      reply.code(401).send({
        error: 'Timestamp outside valid range',
        code: 'INVALID_TIMESTAMP'
      })
      return reply.hijack()
    }

    try {
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

      const deviceSecret = device[0].secretHash
      const method = request.method
      const url = new URL(request.url, `https://${request.headers.host}`)
      const path = url.pathname + url.search
      const bodyPayload =
        request.body === undefined || request.body === null
          ? ''
          : typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body)
      const bodyHash = computeBodyHash(bodyPayload)
      const canonicalString = createCanonicalString(method, path, bodyHash, timestamp)

      if (!verifySignature(canonicalString, signature, deviceSecret)) {
        reply.code(401).send({
          error: 'Invalid signature',
          code: 'INVALID_SIGNATURE'
        })
        return reply.hijack()
      }

      const requestTime = Date.parse(timestamp)
      if (!checkReplay(deviceId, signature, requestTime)) {
        reply.code(401).send({
          error: 'Replay detected',
          code: 'REPLAY_DETECTED'
        })
        return reply.hijack()
      }

      request.device = {
        id: deviceId,
        authenticated: true,
      }

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

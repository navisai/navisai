import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000
const NONCE_CACHE = new Map()

function normalizeAuthHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith('Navis ')) {
    return null
  }

  const authPart = authHeader.slice(6).trim()
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

  return {
    deviceId: result.deviceId,
    signature: result.signature,
    timestamp: result.timestamp,
  }
}

export function parseAuthHeader(authHeader) {
  return normalizeAuthHeader(authHeader)
}

export function computeBodyHash(body) {
  if (!body) {
    return ''
  }
  const value = typeof body === 'string' ? body : JSON.stringify(body)
  return createHash('sha256').update(value).digest('hex')
}

export function createCanonicalString(method, path, bodyHash, timestamp) {
  return `${method}\n${path}\n${bodyHash}\n${timestamp}`
}

export function createWebSocketCanonicalString(path, timestamp) {
  return `WEBSOCKET\n${path}\n-\n${timestamp}`
}

export function verifySignature(canonicalString, signature, deviceSecret) {
  try {
    const expected = createHmac('sha256', deviceSecret).update(canonicalString).digest()
    const provided = Buffer.from(signature, 'base64')
    if (expected.length !== provided.length) {
      return false
    }
    return timingSafeEqual(expected, provided)
  } catch (error) {
    return false
  }
}

export function isTimestampValid(timestamp) {
  const requestTime = Date.parse(timestamp)
  if (Number.isNaN(requestTime)) {
    return false
  }
  const now = Date.now()
  return Math.abs(now - requestTime) <= MAX_TIMESTAMP_SKEW_MS
}

export function checkReplay(deviceId, signature, timestamp) {
  const key = `${deviceId}:${signature}`
  const existing = NONCE_CACHE.get(key)
  if (existing && timestamp - existing < MAX_TIMESTAMP_SKEW_MS) {
    return false
  }

  NONCE_CACHE.set(key, timestamp)

  const cutoff = Date.now() - MAX_TIMESTAMP_SKEW_MS * 2
  for (const [cacheKey, cacheTime] of NONCE_CACHE.entries()) {
    if (cacheTime < cutoff) {
      NONCE_CACHE.delete(cacheKey)
    }
  }

  return true
}

import { NAVIS_PATHS } from '@navisai/api-contracts'

const API_BASE = 'https://navis.local'
const WS_BASE = `wss://navis.local${NAVIS_PATHS.ws}`
const STORAGE_KEY = 'navis.credentials'
const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
const globalCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : null
const hasWebCrypto = Boolean(globalCrypto?.subtle)
const keyCache = new Map<string, CryptoKey>()

export interface Project {
  id: string
  path: string
  name: string
  createdAt: string
  updatedAt?: string
  detection?: {
    primary: {
      detector: string
      confidence: number
      signals: string[]
      metadata: Record<string, any>
    }
    all: Array<{
      detector: string
      confidence: number
      signals: string[]
      metadata: Record<string, any>
    }>
  }
  classification?: {
    primary: {
      id: string
      name: string
      confidence: number
    }
    language: string
    frameworks: string[]
  }
}

export interface Approval {
  id: string
  projectId?: string
  type: string
  payload: string
  status: 'pending' | 'approved' | 'denied'
  createdAt: string
  resolvedAt?: string
}

export interface Device {
  id: string
  name: string
  publicKey?: string
  pairedAt?: string
  lastSeenAt?: string
  isRevoked: boolean
}

export interface ScanOptions {
  depth?: number
  concurrency?: number
  exclude?: string[]
}

export interface DeviceCredentials {
  deviceId: string
  deviceSecret: string
  deviceName?: string
}

let credentials: DeviceCredentials | null = loadStoredCredentials()

function loadStoredCredentials(): DeviceCredentials | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (parsed?.deviceId && parsed?.deviceSecret) {
      return parsed
    }
  } catch {
    // ignore
  }
  return null
}

function persistCredentials(value: DeviceCredentials) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // ignore
  }
}

function clearStoredCredentials() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (typeof btoa !== 'undefined') {
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  }
  return Buffer.from(bytes).toString('base64')
}

async function sha256Hex(value: string): Promise<string> {
  if (!value) return ''
  if (!hasWebCrypto || !encoder) {
    return value
  }
  const data = encoder.encode(value)
  const digest = await globalCrypto!.subtle.digest('SHA-256', data)
  return bufferToHex(digest)
}

async function importKey(secret: string): Promise<CryptoKey | null> {
  if (!hasWebCrypto || !encoder) return null
  const cached = keyCache.get(secret)
  if (cached) return cached
  const key = await globalCrypto!.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  keyCache.set(secret, key)
  return key
}

async function hmacBase64(message: string, secret: string): Promise<string> {
  if (!hasWebCrypto) {
    throw new Error('Web Crypto not available')
  }
  if (!encoder) {
    throw new Error('TextEncoder not available')
  }
  const key = await importKey(secret)
  if (!key) {
    throw new Error('Unable to import HMAC key')
  }
  const signature = await globalCrypto!.subtle.sign('HMAC', key, encoder.encode(message))
  return bufferToBase64(signature)
}

async function buildAuthHeaders(
  method: string,
  path: string,
  body: string
): Promise<Record<string, string>> {
  if (!credentials || !hasWebCrypto) {
    return {}
  }
  const url = new URL(path, API_BASE)
  const canonicalPath = url.pathname + url.search
  const timestamp = new Date().toISOString()
  const bodyHash = await sha256Hex(body)
  const canonical = `${method}\n${canonicalPath}\n${bodyHash}\n${timestamp}`
  const signature = await hmacBase64(canonical, credentials.deviceSecret)
  return {
    Authorization: `Navis deviceId="${credentials.deviceId}",signature="${signature}",timestamp="${timestamp}"`,
  }
}

async function buildWebSocketUrl(): Promise<string | null> {
  if (!credentials || !hasWebCrypto) {
    return null
  }
  const timestamp = new Date().toISOString()
  const canonical = `WEBSOCKET\n${NAVIS_PATHS.ws}\n-\n${timestamp}`
  const signature = await hmacBase64(canonical, credentials.deviceSecret)
  const wsUrl = new URL(WS_BASE)
  wsUrl.searchParams.set('deviceId', credentials.deviceId)
  wsUrl.searchParams.set('timestamp', timestamp)
  wsUrl.searchParams.set('signature', signature)
  return wsUrl.toString()
}

class ApiClient {
  private ws: WebSocket | null = null
  private wsHandlers = new Map<string, Function[]>()
  private wsConnecting = false

  constructor() {
    void this.connectWebSocket()
  }

  async request(
    method: string,
    path: string,
    options: { body?: string; headers?: Record<string, string> } = {}
  ) {
    const payload = options.body || ''
    const authHeaders = await buildAuthHeaders(method, path, payload)
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(options.headers || {}),
        ...authHeaders,
      },
      body: payload || undefined,
    })
    return response
  }

  async getStatus(): Promise<any> {
    const response = await this.request('GET', NAVIS_PATHS.status)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async getProjects(): Promise<Project[]> {
    const response = await this.request('GET', NAVIS_PATHS.projects.list)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return data.projects || []
  }

  async getProject(id: string): Promise<Project> {
    const response = await this.request('GET', NAVIS_PATHS.projects.byId(id))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async scanDirectory(path: string, options: ScanOptions = {}) {
    const payload = JSON.stringify({ path, options })
    const response = await this.request('POST', NAVIS_PATHS.discovery.scan, {
      body: payload,
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  }

  async getProjectAnalysis(path: string, refresh = false): Promise<Project> {
    // Refs: navisai-sz8 (project analysis implementation)
    const url = new URL(`${this.baseURL}/api/discovery/index`, window.location.origin)
    const body = JSON.stringify({ paths: [path], refresh })

    const response = await this.request('POST', url.pathname + url.search, {
      body,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error || `HTTP ${response.status}`)
    }

    const result = await response.json()

    // Return the analysis for the requested path
    return result.results?.[0] || {
      path,
      success: false,
      error: 'Analysis failed'
    }
  }

  async startPairing(payload: {
    pairingToken: string
    clientName: string
    clientDeviceInfo?: Record<string, any>
  }) {
    const body = JSON.stringify(payload)
    const response = await this.request('POST', NAVIS_PATHS.pairing.start, {
      body,
      headers: {
        'Content-Type': 'application/json',
      },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error || `HTTP ${response.status}`)
    }

    const data = await response.json()
    if (!data.deviceId || !data.deviceSecret) {
      throw new Error('Pairing response missing credentials')
    }

    await this.setDeviceCredentials({
      deviceId: data.deviceId,
      deviceSecret: data.deviceSecret,
      deviceName: data.deviceName || payload.clientName,
    })

    return data
  }

  async indexPaths(paths: string[]) {
    const payload = JSON.stringify({ paths })
    const response = await this.request('POST', NAVIS_PATHS.discovery.index, {
      body: payload,
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  }

  async getPendingApprovals(): Promise<Approval[]> {
    const response = await this.request('GET', NAVIS_PATHS.approvals.pending)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return data.approvals || []
  }

  async getApproval(id: string): Promise<Approval> {
    const response = await this.request('GET', NAVIS_PATHS.approvals.byId(id))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async resolveApproval(id: string, action: 'approve' | 'reject'): Promise<Approval> {
    const path =
      action === 'approve' ? NAVIS_PATHS.approvals.approve(id) : NAVIS_PATHS.approvals.reject(id)
    const response = await this.request('POST', path, {
      body: '',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async getDevices(): Promise<Device[]> {
    const response = await this.request('GET', NAVIS_PATHS.devices.list)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return data.devices || []
  }

  async connectWebSocket() {
    if (this.wsConnecting) return
    this.wsConnecting = true

    if (!credentials) {
      this.wsConnecting = false
      setTimeout(() => void this.connectWebSocket(), 3000)
      return
    }

    const wsUrl = await buildWebSocketUrl()
    if (!wsUrl) {
      this.wsConnecting = false
      setTimeout(() => void this.connectWebSocket(), 3000)
      return
    }

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      console.log('Connected to Navis daemon WebSocket')
      this.emit('connected')
    }

    this.ws.onclose = () => {
      console.log('Disconnected from Navis daemon WebSocket')
      this.ws = null
      this.emit('disconnected')
      setTimeout(() => void this.connectWebSocket(), 3000)
    }

    this.ws.onerror = error => {
      console.error('WebSocket error:', error)
      this.emit('error', error)
    }

    this.ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data)
        this.emit('message', data)
        this.emit(data.type, data)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    this.wsConnecting = false
  }

  async reconnectWebSocket() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    await this.connectWebSocket()
  }

  async setDeviceCredentials(value: DeviceCredentials) {
    credentials = value
    persistCredentials(value)
    await this.reconnectWebSocket()
  }

  clearDeviceCredentials() {
    credentials = null
    clearStoredCredentials()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  on(event: string, handler: Function) {
    if (!this.wsHandlers.has(event)) {
      this.wsHandlers.set(event, [])
    }
    this.wsHandlers.get(event)?.push(handler)
  }

  off(event: string, handler: Function) {
    const handlers = this.wsHandlers.get(event)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  private emit(event: string, data?: any) {
    const handlers = this.wsHandlers.get(event)
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data)
        } catch (error) {
          console.error('WebSocket handler error:', error)
        }
      })
    }
  }
}

export const apiClient = new ApiClient()

export async function storeDeviceCredentials(value: DeviceCredentials) {
  await apiClient.setDeviceCredentials(value)
}

export function clearDeviceCredentials() {
  apiClient.clearDeviceCredentials()
}

export function getDeviceCredentials() {
  return credentials
}

export default apiClient

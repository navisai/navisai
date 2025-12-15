/**
 * NavisAI API Client
 * Handles communication with the Navis daemon
 */

const API_BASE = 'http://127.0.0.1:3415'
const WS_URL = 'ws://127.0.0.1:3415'

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

class ApiClient {
  private ws: WebSocket | null = null
  private wsHandlers: Map<string, Function[]> = new Map()

  constructor() {
    this.connectWebSocket()
  }

  // HTTP API methods
  async getStatus(): Promise<any> {
    const response = await fetch(`${API_BASE}/status`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async getProjects(): Promise<Project[]> {
    const response = await fetch(`${API_BASE}/api/projects`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return data.projects || []
  }

  async getProject(id: string): Promise<Project> {
    const response = await fetch(`${API_BASE}/api/projects/${id}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async scanDirectory(
    path: string,
    options: ScanOptions = {}
  ): Promise<{
    success: boolean
    projects: Project[]
    count: number
    scannedPath: string
  }> {
    const response = await fetch(`${API_BASE}/api/discovery/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, options }),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  }

  async getProjectAnalysis(path: string, refresh = false): Promise<Project> {
    const encodedPath = encodeURIComponent(path)
    const response = await fetch(
      `${API_BASE}/api/discovery/project/${encodedPath}?refresh=${refresh}`
    )
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  }

  async indexPaths(paths: string[]): Promise<{
    success: boolean
    results: Array<{
      path: string
      success: boolean
      project?: Project
      error?: string
    }>
    discovered: number
    total: number
  }> {
    const response = await fetch(`${API_BASE}/api/discovery/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  }

  async getPendingApprovals(): Promise<Approval[]> {
    const response = await fetch(`${API_BASE}/api/approvals/pending`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return data.approvals || []
  }

  async resolveApproval(id: string, action: 'approve' | 'deny'): Promise<Approval> {
    const response = await fetch(`${API_BASE}/api/approvals/${id}/${action}`, {
      method: 'POST',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async getDevices(): Promise<Device[]> {
    const response = await fetch(`${API_BASE}/api/devices`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return data.devices || []
  }

  // WebSocket methods
  connectWebSocket() {
    try {
      this.ws = new WebSocket(WS_URL)

      this.ws.onopen = () => {
        console.log('Connected to Navis daemon WebSocket')
        this.emit('connected')
      }

      this.ws.onclose = () => {
        console.log('Disconnected from Navis daemon WebSocket')
        this.ws = null
        this.emit('disconnected')

        // Auto-reconnect after 3 seconds
        setTimeout(() => this.connectWebSocket(), 3000)
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
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
      // Retry after 5 seconds
      setTimeout(() => this.connectWebSocket(), 5000)
    }
  }

  on(event: string, handler: Function) {
    if (!this.wsHandlers.has(event)) {
      this.wsHandlers.set(event, [])
    }
    this.wsHandlers.get(event)!.push(handler)
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

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.warn('WebSocket not connected, cannot send message')
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}

// Export singleton instance
export const apiClient = new ApiClient()
export default apiClient

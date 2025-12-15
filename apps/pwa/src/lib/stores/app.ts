import { writable, derived } from 'svelte/store'
import { apiClient, type Project, type Approval } from '$lib/api/client'

interface AppState {
  connected: boolean
  loading: boolean
  error: string | null
  daemonStatus: any
}

function createAppStore() {
  const { subscribe, set, update } = writable<AppState>({
    connected: false,
    loading: true,
    error: null,
    daemonStatus: null,
  })

  // Initialize connection status from WebSocket
  apiClient.on('connected', () => {
    update(state => ({ ...state, connected: true, error: null }))
  })

  apiClient.on('disconnected', () => {
    update(state => ({ ...state, connected: false }))
  })

  apiClient.on('error', error => {
    update(state => ({
      ...state,
      error: error.message || 'Connection error',
      loading: false,
    }))
  })

  const refreshStatus = async () => {
    try {
      update(state => ({ ...state, loading: true, error: null }))
      const status = await apiClient.getStatus()
      update(state => ({
        ...state,
        daemonStatus: status,
        loading: false,
      }))
    } catch (error) {
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Failed to fetch status',
        loading: false,
      }))
    }
  }

  const clearError = () => {
    update(state => ({ ...state, error: null }))
  }

  return {
    subscribe,
    refreshStatus,
    clearError,
  }
}

export const appStore = createAppStore()

// Derived stores for convenience
export const isConnected = derived(appStore, $app => $app.connected)
export const isLoading = derived(appStore, $app => $app.loading)
export const error = derived(appStore, $app => $app.error)
export const daemonStatus = derived(appStore, $app => $app.daemonStatus)

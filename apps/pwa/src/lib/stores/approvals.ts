import { writable, derived } from 'svelte/store'
import { apiClient, type Approval } from '$lib/api/client'

interface ApprovalsState {
  pending: Approval[]
  loading: boolean
  error: string | null
  resolving: string[]
}

const livePrompt = writable<Approval | null>(null)

function createApprovalsStore() {
  const { subscribe, set, update } = writable<ApprovalsState>({
    pending: [],
    loading: true,
    error: null,
    resolving: [],
  })

  const loadPendingApprovals = async () => {
    try {
      update(state => ({ ...state, loading: true, error: null }))
      const approvals = await apiClient.getPendingApprovals()
      update(state => ({
        ...state,
        pending: approvals,
        loading: false,
      }))
    } catch (error) {
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Failed to load approvals',
        loading: false,
      }))
    }
  }

  const resolveApproval = async (id: string, action: 'approve' | 'reject') => {
    try {
      update(state => ({
        ...state,
        resolving: [...state.resolving, id],
        error: null,
      }))

      const approval = await apiClient.resolveApproval(id, action)

      update(state => ({
        ...state,
        pending: state.pending.filter(a => a.id !== id),
        resolving: state.resolving.filter(rid => rid !== id),
      }))

      return approval
    } catch (error) {
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : `Failed to ${action} approval`,
        resolving: state.resolving.filter(rid => rid !== id),
      }))
      throw error
    }
  }

  const approve = (id: string) => resolveApproval(id, 'approve')
  const reject = (id: string) => resolveApproval(id, 'reject')

  const addApproval = (approval: Approval) => {
    update(state => ({
      ...state,
      pending: state.pending.some(a => a.id === approval.id)
        ? state.pending.map(a => (a.id === approval.id ? approval : a))
        : [...state.pending, approval],
    }))
  }

  const removeApproval = (id: string) => {
    update(state => ({
      ...state,
      pending: state.pending.filter(a => a.id !== id),
    }))
  }

  const clearError = () => {
    update(state => ({ ...state, error: null }))
  }

  const triggerLivePrompt = (approval: Approval) => {
    livePrompt.set(approval)
  }

  const clearLivePrompt = () => {
    livePrompt.set(null)
  }

  // Listen for approval updates from WebSocket
  apiClient.on('approval.request', (data: any) => {
    if (data?.approval) {
      addApproval(data.approval)
      triggerLivePrompt(data.approval)
    }
  })

  apiClient.on('approval.updated', (data: any) => {
    if (data?.approval) {
      update(state => ({
        ...state,
        pending: state.pending.filter(it => it.id !== data.approval.id),
      }))
      clearLivePrompt()
    }
  })

  return {
    subscribe,
    loadPendingApprovals,
    approve,
    reject,
    resolveApproval,
    addApproval,
    removeApproval,
    clearError,
    approvalPrompt: livePrompt,
    clearLivePrompt,
  }
}

export const approvalsStore = createApprovalsStore()

// Derived stores
export const pendingApprovals = derived(approvalsStore, $approvals => $approvals.pending)
export const isLoadingApprovals = derived(approvalsStore, $approvals => $approvals.loading)
export const approvalsError = derived(approvalsStore, $approvals => $approvals.error)
export const isResolving = derived(approvalsStore, $approvals => $approvals.resolving)
export const approvalPrompt = livePrompt

/**
 * Approval Service
 * Manages approval workflow for privileged operations
 */

export class ApprovalService {
  constructor() {
    this.approvals = new Map()
    this.wsManager = null
  }

  async initialize() {
    console.log('✅ Approval service initialized')
  }

  async listApprovals() {
    return {
      approvals: Array.from(this.approvals.values())
    }
  }

  async getApproval(id) {
    const approval = this.approvals.get(id)
    if (!approval) {
      throw new Error('Approval not found')
    }
    return approval
  }

  async createApproval(type, payload, metadata = {}) {
    const approval = {
      id: this.generateId(),
      type,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
      ...metadata
    }

    this.approvals.set(approval.id, approval)
    this.emit('approval.request', { approval })
    return approval
  }

  async approve(id) {
    const approval = this.approvals.get(id)
    if (!approval) {
      throw new Error('Approval not found')
    }

    if (approval.status !== 'pending') {
      throw new Error('Approval already processed')
    }

    approval.status = 'approved'
    approval.resolvedAt = new Date().toISOString()
    this.approvals.set(id, approval)
    this.emit('approval.updated', { approval })
    return approval
  }

  async reject(id) {
    const approval = this.approvals.get(id)
    if (!approval) {
      throw new Error('Approval not found')
    }

    if (approval.status !== 'pending') {
      throw new Error('Approval already processed')
    }

    approval.status = 'denied'
    approval.resolvedAt = new Date().toISOString()
    this.approvals.set(id, approval)
    this.emit('approval.updated', { approval })
    return approval
  }

  async cleanupExpired() {
    const now = new Date()
    for (const [id, approval] of this.approvals) {
      if (new Date(approval.expiresAt) < now) {
        approval.status = 'denied'
        approval.deniedReason = 'expired'
        approval.resolvedAt = approval.resolvedAt || new Date().toISOString()
        this.approvals.set(id, approval)
      }
    }
  }

  generateId() {
    return 'approval_' + Math.random().toString(36).substr(2, 9)
  }

  setWebSocketManager(wsManager) {
    this.wsManager = wsManager
  }

  emit(type, payload = {}) {
    if (!this.wsManager) return
    this.wsManager.broadcast({ type, ...payload }, 'approvals')
  }
}

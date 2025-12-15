/**
 * Navis Approvals Engine
 * Manages approval workflows and policies
 */

import { logger } from '@navisai/logging'

export class ApprovalsEngine {
  constructor(repositories, events) {
    this.repositories = repositories
    this.events = events
    this.policies = new Map()
    this.activeWorkflows = new Map()

    // Load default policies
    this.loadDefaultPolicies()
  }

  /**
   * Load default approval policies
   */
  loadDefaultPolicies() {
    // Terminal command approvals
    this.addPolicy('terminal_command', {
      autoApprove: false,
      timeout: 300000, // 5 minutes
      dangerousCommands: [
        'rm -rf',
        'sudo rm',
        'dd if=',
        'mkfs',
        'format',
        'fdisk',
        ':(){ :|:& };:',
        'sudo su',
        'su root'
      ],
      safeCommands: [
        'ls',
        'pwd',
        'cat',
        'grep',
        'find',
        'ps',
        'top',
        'git status',
        'git log',
        'git diff'
      ]
    })

    // File operation approvals
    this.addPolicy('file_operation', {
      autoApprove: false,
      timeout: 600000, // 10 minutes
      dangerousPatterns: [
        /\.navis\//,      // Don't touch Navis config
        /\/etc\//,        // System files
        /\/boot\//,       // Boot files
        /\.ssh\//,        // SSH keys
        /\.gnupg\//       // GPG keys
      ],
      safePatterns: [
        /src\//,          // Source code
        /docs\//,         // Documentation
        /README/,         // README files
        /\.md$/,          // Markdown files
        /\.json$/,        // JSON config files
        /\.yaml$/,        // YAML config files
        /\.yml$/          // YAML config files
      ]
    })

    // Project creation/modification approvals
    this.addPolicy('project_modification', {
      autoApprove: false,
      timeout: 180000, // 3 minutes
      requiresProjectOwner: true
    })

    // Network operation approvals
    this.addPolicy('network_operation', {
      autoApprove: false,
      timeout: 120000, // 2 minutes
      allowedHosts: [
        'localhost',
        '127.0.0.1',
        'navis.local',
        '*.github.com',
        '*.gitlab.com'
      ]
    })
  }

  /**
   * Add or update an approval policy
   */
  addPolicy(type, policy) {
    this.policies.set(type, {
      ...policy,
      createdAt: new Date().toISOString()
    })

    logger.info('Approval policy added', { type, policy })
  }

  /**
   * Get policy for an approval type
   */
  getPolicy(type) {
    return this.policies.get(type) || this.getDefaultPolicy()
  }

  /**
   * Get default policy for unknown types
   */
  getDefaultPolicy() {
    return {
      autoApprove: false,
      timeout: 300000,
      requiresExplicitApproval: true
    }
  }

  /**
   * Create a new approval request
   */
  async createApproval(type, payload, options = {}) {
    const {
      projectId = null,
      userId = null,
      context = {},
      priority = 'normal'
    } = options

    try {
      const policy = this.getPolicy(type)

      // Check if auto-approval is allowed
      if (policy.autoApprove && await this.shouldAutoApprove(type, payload, policy)) {
        logger.info('Approval auto-approved', { type, payload })
        return {
          approved: true,
          reason: 'Auto-approved by policy',
          approval: null
        }
      }

      // Create approval request
      const approvalData = {
        type,
        payload: {
          ...payload,
          context,
          priority,
          requestedBy: userId
        },
        projectId
      }

      const approval = await this.repositories.approvals.create(approvalData)

      // Set expiration timer
      if (policy.timeout) {
        setTimeout(async () => {
          await this.checkExpiration(approval.id)
        }, policy.timeout)
      }

      // Emit approval requested event
      this.events.approvalRequested(approval)

      logger.info('Approval request created', {
        approvalId: approval.id,
        type,
        projectId
      })

      return {
        approved: false,
        approval,
        policy
      }

    } catch (error) {
      logger.error('Failed to create approval', { type, error: error.message })
      throw error
    }
  }

  /**
   * Resolve an approval (approve/deny)
   */
  async resolveApproval(approvalId, action, options = {}) {
    const { userId = null, reason = null } = options

    try {
      const approval = await this.repositories.approvals.findById(approvalId)

      if (!approval) {
        throw new Error('Approval not found')
      }

      if (approval.status !== 'pending') {
        throw new Error(`Approval already ${approval.status}`)
      }

      const resolvedApproval = await this.repositories.approvals.resolve(
        approvalId,
        action === 'approve' ? 'approved' : 'denied'
      )

      // Update approval with resolution metadata
      if (reason) {
        const updatedPayload = JSON.parse(resolvedApproval.payload)
        updatedPayload.resolutionReason = reason
        updatedPayload.resolvedBy = userId

        await this.repositories.approvals.update(approvalId, {
          payload: JSON.stringify(updatedPayload)
        })
      }

      // Emit resolved event
      this.events.approvalResolved(resolvedApproval)

      logger.info('Approval resolved', {
        approvalId,
        action,
        userId
      })

      return resolvedApproval

    } catch (error) {
      logger.error('Failed to resolve approval', {
        approvalId,
        action,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Check if approval should be auto-approved
   */
  async shouldAutoApprove(type, payload, policy) {
    if (!policy.autoApprove) {
      return false
    }

    switch (type) {
      case 'terminal_command':
        return this.isSafeTerminalCommand(payload.command, policy)

      case 'file_operation':
        return this.isSafeFileOperation(payload.path, policy)

      default:
        return false
    }
  }

  /**
   * Check if terminal command is safe
   */
  isSafeTerminalCommand(command, policy) {
    const cmd = command.trim().toLowerCase()

    // Check for dangerous commands
    for (const dangerous of policy.dangerousCommands) {
      if (cmd.includes(dangerous.toLowerCase())) {
        return false
      }
    }

    // Check if it's a known safe command
    for (const safe of policy.safeCommands) {
      if (cmd.startsWith(safe)) {
        return true
      }
    }

    return false
  }

  /**
   * Check if file operation is safe
   */
  isSafeFileOperation(path, policy) {
    const normalizedPath = path.toLowerCase()

    // Check for dangerous patterns
    for (const dangerous of policy.dangerousPatterns) {
      if (dangerous.test(normalizedPath)) {
        return false
      }
    }

    // Check if it matches safe patterns
    for (const safe of policy.safePatterns) {
      if (safe.test(normalizedPath)) {
        return true
      }
    }

    return false
  }

  /**
   * Check and expire approval if needed
   */
  async checkExpiration(approvalId) {
    try {
      const approval = await this.repositories.approvals.findById(approvalId)

      if (!approval || approval.status !== 'pending') {
        return
      }

      const policy = this.getPolicy(approval.type)
      const createdAt = new Date(approval.createdAt)
      const now = new Date()
      const elapsed = now - createdAt

      if (elapsed > policy.timeout) {
        await this.repositories.approvals.resolve(approvalId, 'denied')

        this.events.approvalResolved({
          ...approval,
          status: 'denied',
          resolvedAt: now.toISOString(),
          reason: 'Expired'
        })

        logger.info('Approval expired', { approvalId })
      }
    } catch (error) {
      logger.error('Failed to check approval expiration', {
        approvalId,
        error: error.message
      })
    }
  }

  /**
   * Get pending approvals
   */
  async getPendingApprovals(options = {}) {
    const { type, projectId, limit = 100 } = options

    try {
      let approvals = await this.repositories.approvals.findPending()

      // Apply filters
      if (type) {
        approvals = approvals.filter(a => a.type === type)
      }

      if (projectId) {
        approvals = approvals.filter(a => a.projectId === projectId)
      }

      return approvals.slice(0, limit)

    } catch (error) {
      logger.error('Failed to get pending approvals', { error: error.message })
      throw error
    }
  }

  /**
   * Get approval statistics
   */
  async getStats() {
    try {
      const pending = await this.repositories.approvals.findPending()
      const all = await this.repositories.approvals.findAll()

      const stats = {
        pending: pending.length,
        approved: all.filter(a => a.status === 'approved').length,
        denied: all.filter(a => a.status === 'denied').length,
        total: all.length,
        byType: {},
        policies: Array.from(this.policies.keys())
      }

      // Group by type
      all.forEach(approval => {
        stats.byType[approval.type] = (stats.byType[approval.type] || 0) + 1
      })

      return stats

    } catch (error) {
      logger.error('Failed to get approval stats', { error: error.message })
      throw error
    }
  }

  /**
   * Batch resolve multiple approvals
   */
  async batchResolve(approvalIds, action, options = {}) {
    const results = []

    for (const approvalId of approvalIds) {
      try {
        const result = await this.resolveApproval(approvalId, action, options)
        results.push({ approvalId, success: true, result })
      } catch (error) {
        results.push({
          approvalId,
          success: false,
          error: error.message
        })
      }
    }

    return results
  }
}

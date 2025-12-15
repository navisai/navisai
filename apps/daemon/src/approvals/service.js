/**
 * Navis Approvals Service
 * High-level service for managing approvals in the daemon
 */

import { ApprovalsEngine } from './engine.js'
import { logger } from '@navisai/logging'

export class ApprovalsService {
  constructor(repositories, events) {
    this.engine = new ApprovalsEngine(repositories, events)
    this.repositories = repositories
    this.events = events
  }

  /**
   * Initialize the approvals service
   */
  async initialize() {
    logger.info('Approvals service initializing...')

    // Check for expired approvals on startup
    await this.cleanupExpiredApprovals()

    logger.info('Approvals service initialized')
  }

  /**
   * Request terminal command approval
   */
  async requestTerminalApproval(sessionId, command, options = {}) {
    try {
      const payload = {
        sessionId,
        command,
        workingDirectory: options.workingDirectory,
        environment: options.environment || {}
      }

      return await this.engine.createApproval('terminal_command', payload, {
        projectId: options.projectId,
        userId: options.userId
      })
    } catch (error) {
      logger.error('Failed to request terminal approval', {
        sessionId,
        command,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Request file operation approval
   */
  async requestFileApproval(operation, path, options = {}) {
    try {
      const payload = {
        operation, // 'read', 'write', 'delete', 'execute'
        path,
        content: options.content,
        permissions: options.permissions
      }

      return await this.engine.createApproval('file_operation', payload, {
        projectId: options.projectId,
        userId: options.userId
      })
    } catch (error) {
      logger.error('Failed to request file approval', {
        operation,
        path,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Request project modification approval
   */
  async requestProjectApproval(projectId, action, details, options = {}) {
    try {
      const payload = {
        action, // 'create', 'update', 'delete'
        details,
        projectId
      }

      return await this.engine.createApproval('project_modification', payload, {
        projectId,
        userId: options.userId
      })
    } catch (error) {
      logger.error('Failed to request project approval', {
        projectId,
        action,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Request network operation approval
   */
  async requestNetworkApproval(operation, target, options = {}) {
    try {
      const payload = {
        operation, // 'connect', 'bind', 'listen'
        target, // host:port
        protocol: options.protocol || 'tcp'
      }

      return await this.engine.createApproval('network_operation', payload, {
        userId: options.userId
      })
    } catch (error) {
      logger.error('Failed to request network approval', {
        operation,
        target,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Get all pending approvals with details
   */
  async getPendingApprovals(options = {}) {
    try {
      const approvals = await this.engine.getPendingApprovals(options)

      // Enrich with project details
      const enrichedApprovals = await Promise.all(
        approvals.map(async (approval) => {
          const enriched = { ...approval }

          if (approval.projectId) {
            const project = await this.repositories.projects.findById(approval.projectId)
            enriched.project = project ? {
              id: project.id,
              name: project.name,
              path: project.path
            } : null
          }

          // Parse payload for easier consumption
          enriched.payloadParsed = typeof approval.payload === 'string'
            ? JSON.parse(approval.payload)
            : approval.payload

          return enriched
        })
      )

      return enrichedApprovals
    } catch (error) {
      logger.error('Failed to get pending approvals', { error: error.message })
      throw error
    }
  }

  /**
   * Approve an action
   */
  async approve(approvalId, options = {}) {
    try {
      const approval = await this.repositories.approvals.findById(approvalId)
      if (!approval) {
        throw new Error('Approval not found')
      }

      const resolvedApproval = await this.engine.resolveApproval(
        approvalId,
        'approve',
        options
      )

      // Execute the approved action
      await this.executeApprovedAction(resolvedApproval)

      return resolvedApproval
    } catch (error) {
      logger.error('Failed to approve action', {
        approvalId,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Deny an action
   */
  async deny(approvalId, options = {}) {
    try {
      const resolvedApproval = await this.engine.resolveApproval(
        approvalId,
        'deny',
        options
      )

      // Emit denied event
      this.events.broadcast('action_denied', {
        approvalId,
        reason: options.reason || 'Denied by user'
      })

      return resolvedApproval
    } catch (error) {
      logger.error('Failed to deny action', {
        approvalId,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Execute an approved action
   */
  async executeApprovedAction(approval) {
    const payload = typeof approval.payload === 'string'
      ? JSON.parse(approval.payload)
      : approval.payload

    try {
      switch (approval.type) {
        case 'terminal_command':
          await this.executeTerminalCommand(payload)
          break

        case 'file_operation':
          await this.executeFileOperation(payload)
          break

        case 'project_modification':
          await this.executeProjectModification(payload)
          break

        case 'network_operation':
          await this.executeNetworkOperation(payload)
          break

        default:
          logger.warn('Unknown approval type for execution', {
            type: approval.type
          })
      }
    } catch (error) {
      logger.error('Failed to execute approved action', {
        approvalId: approval.id,
        type: approval.type,
        error: error.message
      })

      // Don't throw here - the approval was already granted
      // Just log the error for debugging
    }
  }

  /**
   * Execute approved terminal command
   */
  async executeTerminalCommand(payload) {
    const { sessionId, command } = payload

    this.events.broadcast('terminal_command_approved', {
      sessionId,
      command,
      executedAt: new Date().toISOString()
    })

    // Note: Actual command execution would be handled by the terminal session manager
    logger.info('Terminal command approved for execution', {
      sessionId,
      command
    })
  }

  /**
   * Execute approved file operation
   */
  async executeFileOperation(payload) {
    const { operation, path } = payload

    this.events.broadcast('file_operation_approved', {
      operation,
      path,
      executedAt: new Date().toISOString()
    })

    logger.info('File operation approved', {
      operation,
      path
    })
  }

  /**
   * Execute approved project modification
   */
  async executeProjectModification(payload) {
    const { action, projectId, details } = payload

    this.events.broadcast('project_modification_approved', {
      action,
      projectId,
      details,
      executedAt: new Date().toISOString()
    })

    logger.info('Project modification approved', {
      action,
      projectId
    })
  }

  /**
   * Execute approved network operation
   */
  async executeNetworkOperation(payload) {
    const { operation, target } = payload

    this.events.broadcast('network_operation_approved', {
      operation,
      target,
      executedAt: new Date().toISOString()
    })

    logger.info('Network operation approved', {
      operation,
      target
    })
  }

  /**
   * Clean up expired approvals
   */
  async cleanupExpiredApprovals() {
    try {
      const allApprovals = await this.repositories.approvals.findAll()
      const now = new Date()

      for (const approval of allApprovals) {
        if (approval.status === 'pending') {
          const policy = this.engine.getPolicy(approval.type)
          const createdAt = new Date(approval.createdAt)
          const elapsed = now - createdAt

          if (elapsed > policy.timeout) {
            await this.repositories.approvals.resolve(approval.id, 'denied')

            logger.info('Cleaned up expired approval', {
              approvalId: approval.id,
              type: approval.type,
              elapsed
            })
          }
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup expired approvals', {
        error: error.message
      })
    }
  }

  /**
   * Get approval statistics
   */
  async getStats() {
    return await this.engine.getStats()
  }

  /**
   * Get policies for display
   */
  getPolicies() {
    const policies = {}

    for (const [type, policy] of this.engine.policies) {
      policies[type] = {
        autoApprove: policy.autoApprove,
        timeout: policy.timeout,
        description: this.getPolicyDescription(type)
      }
    }

    return policies
  }

  /**
   * Get human-readable policy description
   */
  getPolicyDescription(type) {
    const descriptions = {
      terminal_command: 'Approval required for terminal commands, with auto-approval for safe commands',
      file_operation: 'Approval required for file operations, especially system files',
      project_modification: 'Approval required for project creation and modification',
      network_operation: 'Approval required for network connections to external hosts'
    }

    return descriptions[type] || 'Approval required for this operation type'
  }
}

export default ApprovalsService

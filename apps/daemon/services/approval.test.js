import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalService } from './approval.js'

test('createApproval stores pending approval and notifies ws manager', async () => {
  const service = new ApprovalService()
  const broadcasts = []
  service.setWebSocketManager({
    broadcast: (payload, channel) => broadcasts.push({ payload, channel }),
  })

  const approval = await service.createApproval('pairing', { token: 'abc' })
  assert.equal(approval.status, 'pending')
  assert.equal(typeof approval.id, 'string')
  assert.equal(approval.payload, JSON.stringify({ token: 'abc' }))
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0].payload.type, 'approval.request')
  assert.equal(broadcasts[0].channel, 'approvals')
})

test('approve updates approval status and emits update', async () => {
  const service = new ApprovalService()
  const broadcasts = []
  service.setWebSocketManager({
    broadcast: (payload, channel) => broadcasts.push({ payload, channel }),
  })

  const approval = await service.createApproval('pairing', 'token')
  const updated = await service.approve(approval.id)
  assert.equal(updated.status, 'approved')
  assert.ok(updated.resolvedAt)
  assert.equal(broadcasts.some(entry => entry.payload.type === 'approval.updated'), true)
})

test('reject updates approval status and emits update', async () => {
  const service = new ApprovalService()
  const broadcasts = []
  service.setWebSocketManager({
    broadcast: (payload, channel) => broadcasts.push({ payload, channel }),
  })

  const approval = await service.createApproval('pairing', 'token')
  const updated = await service.reject(approval.id)
  assert.equal(updated.status, 'denied')
  assert.ok(updated.resolvedAt)
  assert.equal(broadcasts.some(entry => entry.payload.type === 'approval.updated'), true)
})

test('cleanupExpired marks expired approvals as denied', async () => {
  const service = new ApprovalService()
  const approval = await service.createApproval('pairing', 'token')
  approval.expiresAt = new Date(Date.now() - 1000).toISOString()
  service.approvals.set(approval.id, approval)

  await service.cleanupExpired()
  const updated = await service.getApproval(approval.id)
  assert.equal(updated.status, 'denied')
  assert.equal(updated.deniedReason, 'expired')
  assert.ok(updated.resolvedAt)
})

test('approve throws when already processed', async () => {
  const service = new ApprovalService()
  const approval = await service.createApproval('pairing', 'token')
  await service.approve(approval.id)

  await assert.rejects(() => service.approve(approval.id), {
    message: 'Approval already processed',
  })
})

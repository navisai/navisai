import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalService } from './approval.js'
import { PairingService } from './pairing.js'

function createReplyStub() {
  return {
    status: null,
    code(value) {
      this.status = value
    },
  }
}

test('generatePairingData stores token and metadata', async () => {
  const service = new PairingService()
  const pairingData = await service.generatePairingData()
  assert.ok(pairingData.id)
  assert.equal(service.pairingTokens.has(pairingData.id), true)
  assert.equal(pairingData.type, 'navis-pairing')
})

test('handleStart rejects missing pairing token', async () => {
  const service = new PairingService()
  const reply = createReplyStub()
  const result = await service.handleStart({ body: {} }, reply)
  assert.equal(reply.status, 400)
  assert.equal(result.error, 'pairingToken is required')
})

test('handleStart rejects expired token', async () => {
  const service = new PairingService()
  const reply = createReplyStub()
  const pairingData = await service.generatePairingData()
  service.pairingTokens.set(pairingData.id, {
    ...pairingData,
    expires: new Date(Date.now() - 1000).toISOString(),
  })

  const result = await service.handleStart({ body: { pairingToken: pairingData.id } }, reply)
  assert.equal(reply.status, 401)
  assert.equal(result.error, 'Invalid or expired pairingToken')
})

test('handleStart resolves approved pairing', async () => {
  const approvalService = new ApprovalService()
  const dbManager = {
    execute: async () => {},
    query: async () => [],
  }
  const service = new PairingService({ approvalService, dbManager })
  const reply = createReplyStub()
  const pairingData = await service.generatePairingData()

  const resultPromise = service.handleStart(
    { body: { pairingToken: pairingData.id, clientName: 'Test Device' } },
    reply
  )

  const approvals = await approvalService.listApprovals()
  const approval = approvals.approvals[0]
  await service.onApprovalResolved({ id: approval.id, status: 'approved' })

  const result = await resultPromise
  assert.ok(result.deviceId)
  assert.ok(result.deviceSecret)
  assert.equal(result.deviceName, 'Test Device')
  assert.equal(reply.status, null)
})

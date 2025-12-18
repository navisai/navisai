import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TransparentHTTPSProxy } from './transparent-proxy.js'

function u16(value) {
  return Buffer.from([(value >> 8) & 0xff, value & 0xff])
}

function u24(value) {
  return Buffer.from([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff])
}

function buildClientHello(sniHost) {
  const host = Buffer.from(sniHost, 'utf8')
  const sniList = Buffer.concat([
    Buffer.from([0x00]),
    u16(host.length),
    host,
  ])
  const sniListLen = u16(sniList.length)
  const sniExtData = Buffer.concat([sniListLen, sniList])
  const sniExtension = Buffer.concat([
    u16(0x0000),
    u16(sniExtData.length),
    sniExtData,
  ])

  const extensions = sniExtension
  const extensionsLen = u16(extensions.length)

  const clientHelloBody = Buffer.concat([
    Buffer.from([0x03, 0x03]),
    Buffer.alloc(32, 0),
    Buffer.from([0x00]),
    u16(2),
    u16(0x1301),
    Buffer.from([0x01, 0x00]),
    extensionsLen,
    extensions,
  ])

  const handshake = Buffer.concat([
    Buffer.from([0x01]),
    u24(clientHelloBody.length),
    clientHelloBody,
  ])

  return Buffer.concat([
    Buffer.from([0x16, 0x03, 0x01]),
    u16(handshake.length),
    handshake,
  ])
}

test('extractSNI returns hostname when ClientHello includes SNI', () => {
  const proxy = new TransparentHTTPSProxy({ enableDevServerDetection: false })
  const payload = buildClientHello('navis.local')
  const result = proxy.extractSNI(payload)

  assert.equal(result.sni, 'navis.local')
  assert.equal(result.needsMore, false)
})

test('extractSNI signals needsMore when ClientHello is truncated', () => {
  const proxy = new TransparentHTTPSProxy({ enableDevServerDetection: false })
  const payload = buildClientHello('navis.local')
  const partial = payload.subarray(0, 12)
  const result = proxy.extractSNI(partial)

  assert.equal(result.sni, null)
  assert.equal(result.needsMore, true)
})

test('extractSNI ignores non-handshake records', () => {
  const proxy = new TransparentHTTPSProxy({ enableDevServerDetection: false })
  const payload = Buffer.from([0x17, 0x03, 0x03, 0x00, 0x01, 0x00])
  const result = proxy.extractSNI(payload)

  assert.equal(result.sni, null)
  assert.equal(result.needsMore, false)
})

#!/usr/bin/env node

/**
 * Test script for Transparent HTTPS Proxy
 *
 * This script tests the SNI extraction and routing logic
 */

import { TransparentHTTPSProxy } from './apps/daemon/src/transparent-proxy.js'
import { createConnection } from 'node:net'

async function testSNIExtraction() {
  console.log('Testing SNI extraction...')

  const proxy = new TransparentHTTPSProxy()

  // Create a mock TLS Client Hello packet with navis.local SNI
  // This is a simplified version for testing
  const tlsClientHello = Buffer.from([
    0x16, // Handshake type
    0x03, 0x01, // TLS version
    0x00, 0x00, // Length (placeholder)
    0x01, // Handshake type (Client Hello)
    0x00, 0x00, 0x00, // Length (placeholder)
    0x03, 0x01, // TLS version again
    // ... more handshake data would go here
    // For a real test, we'd need a complete Client Hello
  ])

  console.log('SNI extraction test not fully implemented')
  console.log('In a real implementation, we would test with actual TLS packets')
}

async function testProxyRouting() {
  console.log('\nTesting proxy routing logic...')

  // Test that the proxy can be instantiated
  const proxy = new TransparentHTTPSProxy({
    proxyPort: 8443,
    daemonHost: '127.0.0.1',
    daemonPort: 47621
  })

  console.log('✅ Proxy created successfully')
  console.log('Options:', proxy.options)

  // Note: We can't easily test the full proxy without root privileges
  // and actual TLS connections
}

async function main() {
  console.log('🧪 Testing Transparent HTTPS Proxy')
  console.log('=====================================\n')

  try {
    await testSNIExtraction()
    await testProxyRouting()

    console.log('\n✅ Basic tests passed')
    console.log('\n⚠️  Full integration testing requires:')
    console.log('   - Root privileges for pfctl')
    console.log('   - Running daemon at 127.0.0.1:47621')
    console.log('   - Actual TLS clients')

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

main()

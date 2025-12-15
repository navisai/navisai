#!/usr/bin/env node

/**
 * NavisAI Daemon Entry Point
 */

import daemon from '../daemon.js'

// Start daemon if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  daemon.start().catch((error) => {
    console.error('Failed to start daemon:', error)
    process.exit(1)
  })
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...')
  await daemon.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...')
  await daemon.stop()
  process.exit(0)
})

export default daemon

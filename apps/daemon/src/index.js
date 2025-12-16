#!/usr/bin/env node

/**
 * NavisAI Daemon Entry Point
 */

import daemon from '../daemon.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Start daemon if run directly
const selfPath = fileURLToPath(import.meta.url)
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : null

if (argvPath && path.resolve(selfPath) === argvPath) {
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

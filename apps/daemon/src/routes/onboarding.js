/**
 * Onboarding routes for Navis daemon
 * Serves the welcome flow and pairing interface
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@navisai/logging'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export async function onboardingRoutes(fastify, options) {
  // Welcome page
  fastify.get('/welcome', async (request, reply) => {
    try {
      const welcomePath = join(__dirname, '../static/welcome.html')
      const content = await readFile(welcomePath, 'utf8')
      reply.type('text/html')
      return content
    } catch (error) {
      logger.error('Failed to serve welcome page', { error: error.message })
      reply.code(500)
      return '<h1>Error loading welcome page</h1>'
    }
  })

  // Pairing flow
  fastify.get('/pairing', async (request, reply) => {
    try {
      const pairingPath = join(__dirname, '../static/pairing.html')
      const content = await readFile(pairingPath, 'utf8')
      reply.type('text/html')
      return content
    } catch (error) {
      logger.error('Failed to serve pairing page', { error: error.message })
      reply.code(500)
      return '<h1>Error loading pairing page</h1>'
    }
  })

  // Generate QR code for pairing
  fastify.get('/pairing/qr', async (request, reply) => {
    // Generate pairing data for QR code
    const pairingData = {
      id: `navis-${Date.now()}`,
      name: 'Navis Local',
      url: 'https://navis.local',
      timestamp: Date.now()
    }

    reply.type('application/json')
    return { pairingData }
  })
}

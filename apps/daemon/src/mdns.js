/**
 * mDNS Service Announcer
 * Announces the Navis daemon service on the local network
 */

import multicastDns from 'multicast-dns'
import { logger } from '@navisai/logging'

export class MDNSAnnouncer {
  constructor(port = 3415) {
    this.port = port
    this.mdns = null
    this.name = 'navis'
  }

  start() {
    try {
      this.mdns = multicastDns()

      // Announce HTTP service
      this.mdns.respond({
        answers: [{
          name: `${this.name}._http._tcp.local`,
          type: 'PTR',
          data: `${this.name}-http._http._tcp.local`
        }, {
          name: `${this.name}-http._http._tcp.local`,
          type: 'SRV',
          data: {
            target: 'navis.local',
            port: this.port,
            weight: 1,
            priority: 10
          }
        }, {
          name: `${this.name}-http._http._tcp.local`,
          type: 'TXT',
          data: ['path=/', 'ssl=true']
        }]
      })

      logger.info('mDNS announcer started', {
        name: this.name,
        port: this.port,
        url: `https://navis.local:${this.port}`
      })
    } catch (error) {
      logger.warn('mDNS announcer failed to start', { error: error.message })
    }
  }

  stop() {
    if (this.mdns) {
      this.mdns.destroy()
      this.mdns = null
      logger.info('mDNS announcer stopped')
    }
  }
}

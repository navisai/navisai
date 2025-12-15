#!/usr/bin/env node

import { createServer } from 'node:http'
import { MulticastDNS } from 'multicast-dns'

export class NavisMDNS {
  constructor() {
    this.mdns = MulticastDNS()
    this.serviceName = 'navis'
    this.serviceType = 'https'
    this.hostname = 'navis'
  }

  async advertise(port) {
    return new Promise((resolve, reject) => {
      // Announce our service
      this.mdns.respond([
        {
          name: `${this.serviceName}.${this.serviceType}.local`,
          type: 'SRV',
          data: {
            target: `${this.hostname}.local`,
            port: port,
            weight: 0,
            priority: 10,
          },
        },
        {
          name: `${this.serviceName}.${this.serviceType}.local`,
          type: 'TXT',
          data: ['path=/', 'proto=https'],
        },
        {
          name: `${this.hostname}.local`,
          type: 'A',
          data: '127.0.0.1',
        },
      ])

      console.log(`📡 Advertising navis service on port ${port} via mDNS`)
      resolve()
    })
  }

  async discover() {
    return new Promise((resolve, reject) => {
      const services = []

      // Query for navis services
      this.mdns.query([
        {
          name: `${this.serviceName}.${this.serviceType}.local`,
          type: 'SRV',
        },
        {
          name: `${this.serviceName}.${this.serviceType}.local`,
          type: 'TXT',
        },
      ])

      this.mdns.on('response', (response) => {
        response.answers.forEach(answer => {
          if (answer.type === 'SRV' && answer.name.includes('navis')) {
            services.push({
              host: answer.data.target,
              port: answer.data.port,
              url: `https://${answer.data.target}:${answer.data.port}`,
            })
          }
        })
      })

      // Wait a bit for responses
      setTimeout(() => {
        resolve(services)
      }, 2000)
    })
  }

  stop() {
    this.mdns.destroy()
  }
}

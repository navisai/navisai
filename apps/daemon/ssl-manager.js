/**
 * SSL Manager
 * Handles SSL certificate generation and management
 */

import { readFile, writeFile, access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export class SSLManager {
  constructor() {
    this.dataDir = join(homedir(), '.navis')
    this.certsDir = join(this.dataDir, 'certs')

    // Canonical locations (docs/SETUP.md)
    this.keyFile = join(this.certsDir, 'navis.local.key')
    this.certFile = join(this.certsDir, 'navis.local.crt')

    // Legacy locations (migration)
    this.legacyKeyFile = join(this.dataDir, 'navis.key')
    this.legacyCertFile = join(this.dataDir, 'navis.crt')
  }

  async ensureCertificates() {
    try {
      // Create data directory if it doesn't exist
      await mkdir(this.certsDir, { recursive: true })

      // Migrate legacy certs if present
      const legacyKeyExists = await this.fileExists(this.legacyKeyFile)
      const legacyCertExists = await this.fileExists(this.legacyCertFile)
      const keyExists = await this.fileExists(this.keyFile)
      const certExists = await this.fileExists(this.certFile)

      if (!keyExists && !certExists && legacyKeyExists && legacyCertExists) {
        const legacyKey = await readFile(this.legacyKeyFile)
        const legacyCert = await readFile(this.legacyCertFile)
        await writeFile(this.keyFile, legacyKey)
        await writeFile(this.certFile, legacyCert)
      }

      // Check if certificates already exist
      if (keyExists && certExists) {
        console.log('📜 SSL certificates found')
        return
      }

      console.log('🔐 Generating SSL certificates for navis.local...')
      await this.generateCertificates()

    } catch (error) {
      console.error('Failed to ensure SSL certificates:', error.message)
      throw error
    }
  }

  async generateCertificates() {
    try {
      // Try using selfsigned module first
      const { selfSigned } = await import('selfsigned')

      const attrs = [
        { name: 'commonName', value: 'navis.local' },
        { name: 'countryName', value: 'US' },
        { name: 'localityName', value: 'San Francisco' },
        { name: 'organizationName', value: 'NavisAI' },
        { name: 'organizationUnitName', value: 'Development' }
      ]

      const pems = selfSigned.generate(attrs, {
        days: 365,
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [
          {
            name: 'subjectAltName',
            altNames: [
              { type: 2, value: 'navis.local' },
              { type: 2, value: 'localhost' },
              { type: 7, ip: '127.0.0.1' },
              { type: 7, ip: '::1' }
            ]
          }
        ]
      })

      await writeFile(this.keyFile, pems.private)
      await writeFile(this.certFile, pems.cert)

      console.log('✅ SSL certificates generated with selfsigned')
    } catch (error) {
      console.log('⚠️  selfsigned module not available, falling back to openssl...')
      await this.generateWithOpenSSL()
    }
  }

  async generateWithOpenSSL() {
    const { execSync } = await import('node:child_process')

    try {
      // Generate private key
      execSync(`openssl genrsa -out "${this.keyFile}" 2048`, { stdio: 'ignore' })

      // Generate certificate signing request
      const csrFile = join(this.dataDir, 'navis.csr')
      const config = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = navis.local

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = navis.local
DNS.2 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
`

      const configFile = join(this.dataDir, 'openssl.cnf')
      await writeFile(configFile, config)

      execSync(`openssl req -new -key "${this.keyFile}" -out "${csrFile}" -config "${configFile}"`, { stdio: 'ignore' })

      // Generate self-signed certificate
      execSync(`openssl x509 -req -days 365 -in "${csrFile}" -signkey "${this.keyFile}" -out "${this.certFile}" -extensions v3_req -extfile "${configFile}"`, { stdio: 'ignore' })

      console.log('✅ SSL certificates generated with openssl')
    } catch (error) {
      throw new Error(`Failed to generate SSL certificates: ${error.message}`)
    }
  }

  async getSSLOptions() {
    const key = await readFile(this.keyFile)
    const cert = await readFile(this.certFile)

    return { key, cert }
  }

  async fileExists(filePath) {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }
}

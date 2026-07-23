/**
 * SSL Manager
 * Handles SSL certificate generation and management
 */

import { readFile, writeFile, access, mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export class SSLManager {
  constructor() {
    this.dataDir = join(homedir(), '.navis')
    this.certsDir = join(this.dataDir, 'certs')

    // Canonical locations (docs/SETUP.md)
    this.caKeyFile = join(this.certsDir, 'navis.local-ca.key')
    this.caCertFile = join(this.certsDir, 'navis.local-ca.crt')
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
      const caKeyExists = await this.fileExists(this.caKeyFile)
      const caCertExists = await this.fileExists(this.caCertFile)
      const keyExists = await this.fileExists(this.keyFile)
      const certExists = await this.fileExists(this.certFile)

      if ((caKeyExists && !caCertExists) || (!caKeyExists && caCertExists)) {
        console.warn('⚠️  SSL CA material is incomplete, regenerating...')
        await this.clearLegacyCertificates()
      }
      if ((keyExists && !certExists) || (!keyExists && certExists)) {
        console.warn('⚠️  SSL leaf material is incomplete, regenerating...')
        await this.clearLegacyCertificates()
      }

      if (!keyExists && !certExists && legacyKeyExists && legacyCertExists) {
        const legacyKey = await readFile(this.legacyKeyFile)
        const legacyCert = await readFile(this.legacyCertFile)
        await writeFile(this.keyFile, legacyKey)
        await writeFile(this.certFile, legacyCert)
      }

      // Check if certificates already exist
      if (caKeyExists && caCertExists && keyExists && certExists) {
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
    await this.generateWithOpenSSL()
  }

  async generateWithOpenSSL() {
    const { execSync } = await import('node:child_process')

    try {
      const caKeyExists = await this.fileExists(this.caKeyFile)
      const caCertExists = await this.fileExists(this.caCertFile)

      if (!caKeyExists || !caCertExists) {
        // Generate CA key and certificate
        execSync(`openssl genrsa -out "${this.caKeyFile}" 4096`, { stdio: 'ignore' })

        const caConfig = `
[req]
distinguished_name = ca_dn
prompt = no

[ca_dn]
CN = NavisAI Local Development CA
O = NavisAI
OU = Local Development

[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
`

        const caConfigFile = join(this.dataDir, 'openssl-ca.cnf')
        await writeFile(caConfigFile, caConfig)

        execSync(
          `openssl req -x509 -new -nodes -key "${this.caKeyFile}" -sha256 -days 3650 -out "${this.caCertFile}" -config "${caConfigFile}" -extensions v3_ca`,
          { stdio: 'ignore' }
        )
      }

      // Generate leaf key
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
O = NavisAI
OU = Development

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = navis.local
DNS.2 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
`

      const configFile = join(this.dataDir, 'openssl.cnf')
      await writeFile(configFile, config)

      execSync(`openssl req -new -key "${this.keyFile}" -out "${csrFile}" -config "${configFile}"`, { stdio: 'ignore' })

      // Generate leaf certificate signed by CA
      execSync(
        `openssl x509 -req -days 365 -in "${csrFile}" -CA "${this.caCertFile}" -CAkey "${this.caKeyFile}" -CAcreateserial -out "${this.certFile}" -extensions v3_req -extfile "${configFile}"`,
        { stdio: 'ignore' }
      )

      console.log('✅ SSL certificates generated with openssl (CA + leaf)')
    } catch (error) {
      throw new Error(`Failed to generate SSL certificates: ${error.message}`)
    }
  }

  async getSSLOptions() {
    const key = await readFile(this.keyFile)
    const cert = await readFile(this.certFile)
    const caCert = await readFile(this.caCertFile)

    return { key, cert: Buffer.concat([cert, caCert]) }
  }

  async getCACertificate() {
    return await readFile(this.caCertFile)
  }

  async fileExists(filePath) {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }

  async clearLegacyCertificates() {
    const candidates = [
      this.caKeyFile,
      this.caCertFile,
      this.keyFile,
      this.certFile,
      this.legacyKeyFile,
      this.legacyCertFile,
      join(this.dataDir, 'navis.csr'),
      join(this.dataDir, 'openssl.cnf'),
      join(this.dataDir, 'openssl-ca.cnf'),
      join(this.dataDir, 'navis.local-ca.srl'),
    ]
    await Promise.all(candidates.map(async (file) => {
      try {
        await unlink(file)
      } catch {
        // Ignore missing files.
      }
    }))
  }
}

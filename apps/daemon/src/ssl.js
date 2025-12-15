/**
 * SSL Certificate Generator for Navis Daemon
 * Generates self-signed certificates for localhost HTTPS
 */

import { promises as fs } from 'node:fs'
import { forge } from 'node-forge'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAVIS_DIR = join(homedir(), '.navis')
const CERT_DIR = join(NAVIS_DIR, 'certs')

export class CertificateManager {
  constructor() {
    this.certPath = join(CERT_DIR, 'cert.pem')
    this.keyPath = join(CERT_DIR, 'key.pem')
  }

  async ensureCertificates() {
    // Create .navis/certs directory if it doesn't exist
    await fs.mkdir(CERT_DIR, { recursive: true })

    // Check if certificates already exist and are valid
    if (await this.certificatesExist() && await this.areCertificatesValid()) {
      console.log('✅ Using existing HTTPS certificates')
      return {
        cert: await fs.readFile(this.certPath, 'utf8'),
        key: await fs.readFile(this.keyPath, 'utf8')
      }
    }

    // Generate new certificates
    console.log('🔐 Generating new HTTPS certificates...')
    return await this.generateCertificates()
  }

  async certificatesExist() {
    try {
      await fs.access(this.certPath)
      await fs.access(this.keyPath)
      return true
    } catch {
      return false
    }
  }

  async areCertificatesValid() {
    try {
      const cert = await fs.readFile(this.certPath, 'utf8')
      const key = await fs.readFile(this.keyPath, 'utf8')

      // Parse certificate to check expiration
      const certParsed = forge.pki.certificateFromPem(cert)
      const now = new Date()
      const expires = certParsed.validity.notAfter

      // Check if certificate expires in more than 30 days
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

      return expires > thirtyDaysFromNow
    } catch {
      return false
    }
  }

  async generateCertificates() {
    // Generate a new key pair
    const keys = forge.pki.rsa.generateKeyPair(2048)

    // Create a certificate
    const cert = forge.pki.createCertificate()

    // Set certificate properties
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1)

    // Set subject attributes
    const attrs = [{
      name: 'commonName',
      value: 'navis.local'
    }, {
      name: 'countryName',
      value: 'US'
    }, {
      name: 'stateOrProvinceName',
      value: 'Local'
    }, {
      name: 'localityName',
      value: 'Development'
    }, {
      name: 'organizationName',
      value: 'Navis AI'
    }, {
      name: 'organizationalUnitName',
      value: 'Daemon'
    }]

    cert.setSubject(attrs)

    // Set issuer (self-signed)
    cert.setIssuer(attrs)

    // Add extensions
    cert.setExtensions([{
      name: 'basicConstraints',
      cA: false,
      pathLenConstraint: undefined
    }, {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true
    }, {
      name: 'extKeyUsage',
      serverAuth: true,
      clientAuth: true
    }])

    // Add Subject Alternative Name for localhost
    cert.setExtensions([{
      name: 'subjectAltName',
      altNames: [{
        type: 2, // DNS
        value: 'navis.local'
      }, {
        type: 2, // DNS
        value: 'localhost'
      }, {
        type: 7, // IP
        ip: '127.0.0.1'
      }, {
        type: 7, // IP
        ip: '::1'
      }]
    }])

    // Self-sign the certificate
    cert.sign(keys.privateKey)

    // Convert to PEM format
    const certPem = forge.pki.certificateToPem(cert)
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey)

    // Write to files
    await fs.writeFile(this.certPath, certPem)
    await fs.writeFile(this.keyPath, keyPem)

    console.log('✅ Generated HTTPS certificates for navis.local')
    console.log(`   Cert: ${this.certPath}`)
    console.log(`   Key:  ${this.keyPath}`)

    return { cert: certPem, key: keyPem }
  }

  getHttpsOptions() {
    return {
      key: this.keyPath,
      cert: this.certPath
    }
  }
}

// Export singleton instance
export const certManager = new CertificateManager()

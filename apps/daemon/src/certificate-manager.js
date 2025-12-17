#!/usr/bin/env node

/**
 * Certificate Manager for Multiple Domains
 *
 * Generates, stores, and manages TLS certificates for domain-based forwarding.
 * Creates a root CA per installation and generates certificates on-demand.
 *
 * Refs: navisai-snw
 */

import { generateKeyPair, createSign, createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { logger } from '@navisai/logging'

const DEFAULT_CERT_VALIDITY_DAYS = 90
const CA_VALIDITY_DAYS = 3650 // 10 years
const CERT_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

export class CertificateManager {
  constructor(options = {}) {
    this.options = {
      dataDir: options.dataDir || join(homedir(), '.navis'),
      caKeyFile: 'ca.key',
      caCertFile: 'ca.crt',
      certsDir: 'certs',
      validityDays: options.validityDays || DEFAULT_CERT_VALIDITY_DAYS,
      ...options
    }

    this.caKey = null
    this.caCert = null
    this.certCache = new Map()
    this.cacheTimestamps = new Map()
  }

  /**
   * Initialize the certificate manager
   */
  async initialize() {
    logger.info('Initializing certificate manager...')

    // Ensure data directory exists
    await this.ensureDirectory(this.options.dataDir)
    await this.ensureDirectory(join(this.options.dataDir, this.options.certsDir))

    // Load or create CA
    await this.loadOrCreateCA()

    logger.info('Certificate manager initialized')
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dir) {
    try {
      await access(dir)
    } catch {
      await mkdir(dir, { recursive: true })
    }
  }

  /**
   * Load existing CA or create a new one
   */
  async loadOrCreateCA() {
    const caKeyPath = join(this.options.dataDir, this.options.caKeyFile)
    const caCertPath = join(this.options.dataDir, this.options.caCertFile)

    try {
      // Try to load existing CA
      const [keyData, certData] = await Promise.all([
        readFile(caKeyPath),
        readFile(caCertPath)
      ])

      this.caKey = keyData
      this.caCert = certData

      logger.info('Loaded existing CA certificate')
    } catch (error) {
      // CA doesn't exist, create a new one
      logger.info('Creating new CA certificate...')
      await this.createCA()

      // Save CA files
      await Promise.all([
        writeFile(caKeyPath, this.caKey),
        writeFile(caCertPath, this.caCert)
      ])

      logger.info('Created new CA certificate')

      // Offer to install CA in system trust store
      await this.offerCAInstallation()
    }
  }

  /**
   * Create a new Certificate Authority
   */
  async createCA() {
    // Generate RSA key pair for CA
    const { privateKey, publicKey } = await this.generateRSAKeyPair(4096)

    // Create CA certificate
    const caCert = this.createCACertificate(privateKey, publicKey)

    this.caKey = privateKey
    this.caCert = caCert
  }

  /**
   * Generate RSA key pair
   */
  async generateRSAKeyPair(keySize = 2048) {
    return new Promise((resolve, reject) => {
      generateKeyPair('rsa', {
        modulusLength: keySize,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      }, (err, publicKey, privateKey) => {
        if (err) reject(err)
        else resolve({ publicKey, privateKey })
      })
    })
  }

  /**
   * Create CA certificate
   */
  createCACertificate(privateKey, publicKey) {
    const sign = createSign('SHA256')

    // Certificate structure
    const subject = {
      countryName: 'US',
      stateOrProvinceName: 'California',
      localityName: 'San Francisco',
      organizationName: 'NavisAI',
      organizationalUnitName: 'Local Development',
      commonName: 'NavisAI Local Development CA'
    }

    // Create certificate
    const certInfo = {
      version: 3,
      serialNumber: this.generateSerial(),
      subject: this.formatDN(subject),
      issuer: this.formatDN(subject),
      validity: {
        notBefore: new Date(),
        notAfter: new Date(Date.now() + CA_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
      },
      extensions: {
        basicConstraints: { ca: true, pathLenConstraint: 0 },
        keyUsage: { digitalSignature: true, keyCertSign: true, cRLSign: true },
        subjectKeyIdentifier: this.getKeyIdentifier(publicKey)
      }
    }

    // Sign certificate
    sign.update(Buffer.from(JSON.stringify(certInfo)))
    const signature = sign.sign(privateKey, 'base64')

    return Buffer.concat([
      Buffer.from('-----BEGIN CERTIFICATE-----\n'),
      Buffer.from(JSON.stringify({ ...certInfo, signature }), 'base64'),
      Buffer.from('\n-----END CERTIFICATE-----')
    ])
  }

  /**
   * Generate certificate for a domain
   */
  async generateCertificate(domain) {
    // Check cache first
    const cacheKey = domain.toLowerCase()
    const cached = this.certCache.get(cacheKey)

    if (cached && this.isCacheValid(cacheKey)) {
      logger.debug(`Using cached certificate for ${domain}`)
      return cached
    }

    logger.info(`Generating certificate for ${domain}`)

    // Generate key pair for the domain
    const { privateKey, publicKey } = await this.generateRSAKeyPair(2048)

    // Create certificate signed by CA
    const cert = this.createDomainCertificate(domain, privateKey, publicKey)

    const certBundle = {
      privateKey,
      certificate: cert,
      caCertificate: this.caCert,
      domain,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + this.options.validityDays * 24 * 60 * 60 * 1000)
    }

    // Cache the certificate
    this.certCache.set(cacheKey, certBundle)
    this.cacheTimestamps.set(cacheKey, Date.now())

    // Save to disk
    await this.saveCertificate(domain, certBundle)

    logger.info(`Generated certificate for ${domain}`)
    return certBundle
  }

  /**
   * Create domain certificate
   */
  createDomainCertificate(domain, privateKey, publicKey) {
    const sign = createSign('SHA256')

    // Subject for domain certificate
    const subject = {
      countryName: 'US',
      stateOrProvinceName: 'California',
      localityName: 'San Francisco',
      organizationName: 'NavisAI',
      organizationalUnitName: 'Local Development',
      commonName: domain
    }

    // Create certificate
    const certInfo = {
      version: 3,
      serialNumber: this.generateSerial(),
      subject: this.formatDN(subject),
      issuer: this.extractIssuerFromCA(),
      validity: {
        notBefore: new Date(),
        notAfter: new Date(Date.now() + this.options.validityDays * 24 * 60 * 60 * 1000)
      },
      extensions: {
        basicConstraints: { ca: false },
        keyUsage: { digitalSignature: true, keyEncipherment: true },
        subjectAltName: {
          DNS: [domain, `*.${domain}`, `*.${domain.split('.').slice(-2).join('.')}`]
        },
        authorityKeyIdentifier: this.getAuthorityKeyIdentifier(),
        subjectKeyIdentifier: this.getKeyIdentifier(publicKey)
      }
    }

    // Sign with CA
    sign.update(Buffer.from(JSON.stringify(certInfo)))
    const signature = sign.sign(this.caKey, 'base64')

    return Buffer.concat([
      Buffer.from('-----BEGIN CERTIFICATE-----\n'),
      Buffer.from(JSON.stringify({ ...certInfo, signature }), 'base64'),
      Buffer.from('\n-----END CERTIFICATE-----')
    ])
  }

  /**
   * Save certificate to disk
   */
  async saveCertificate(domain, certBundle) {
    const certDir = join(this.options.dataDir, this.options.certsDir)
    const keyFile = join(certDir, `${domain}.key`)
    const certFile = join(certDir, `${domain}.crt`)
    const bundleFile = join(certDir, `${domain}.json`)

    await Promise.all([
      writeFile(keyFile, certBundle.privateKey),
      writeFile(certFile, certBundle.certificate),
      writeFile(bundleFile, JSON.stringify(certBundle, null, 2))
    ])
  }

  /**
   * Load cached certificate from disk
   */
  async loadCertificate(domain) {
    const cacheKey = domain.toLowerCase()

    // Check memory cache
    if (this.certCache.has(cacheKey) && this.isCacheValid(cacheKey)) {
      return this.certCache.get(cacheKey)
    }

    // Check disk cache
    const bundleFile = join(
      this.options.dataDir,
      this.options.certsDir,
      `${domain}.json`
    )

    try {
      const bundleData = await readFile(bundleFile, 'utf8')
      const certBundle = JSON.parse(bundleData)

      // Check if certificate is still valid
      if (new Date(certBundle.expiresAt) > new Date()) {
        certBundle.privateKey = Buffer.from(certBundle.privateKey)
        certBundle.certificate = Buffer.from(certBundle.certificate)
        certBundle.caCertificate = Buffer.from(certBundle.caCertificate)
        certBundle.issuedAt = new Date(certBundle.issuedAt)
        certBundle.expiresAt = new Date(certBundle.expiresAt)

        // Cache in memory
        this.certCache.set(cacheKey, certBundle)
        this.cacheTimestamps.set(cacheKey, Date.now())

        return certBundle
      }
    } catch (error) {
      // Certificate doesn't exist or is invalid
    }

    return null
  }

  /**
   * Check if cache entry is still valid
   */
  isCacheValid(cacheKey) {
    const timestamp = this.cacheTimestamps.get(cacheKey)
    return timestamp && (Date.now() - timestamp) < CERT_CACHE_TTL
  }

  /**
   * Generate serial number for certificates
   */
  generateSerial() {
    return randomBytes(16).toString('hex')
  }

  /**
   * Format distinguished name
   */
  formatDN(subject) {
    return Object.entries(subject)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')
  }

  /**
   * Extract issuer from CA certificate
   */
  extractIssuerFromCA() {
    // Parse CA certificate to extract issuer
    // For now, return a default
    return 'CN=NavisAI Local Development CA,OU=Local Development,O=NavisAI,L=San Francisco,ST=California,C=US'
  }

  /**
   * Get authority key identifier
   */
  getAuthorityKeyIdentifier() {
    // Return CA key identifier
    return 'keyid:always'
  }

  /**
   * Get subject key identifier
   */
  getKeyIdentifier(publicKey) {
    const hash = createHash('SHA1')
    hash.update(publicKey)
    return hash.digest('hex')
  }

  /**
   * Offer to install CA in system trust store
   */
  async offerCAInstallation() {
    logger.info('\n📜 CA Certificate Created')
    logger.info('The NavisAI CA certificate has been generated.')
    logger.info('To avoid browser security warnings, install it in your system:')
    logger.info('')
    logger.info('macOS:')
    logger.info('  1. Double-click: ~/.navis/ca.crt')
    logger.info('  2. Add to "System" keychain')
    logger.info('  3. Expand "Trust" and set "SSL" to "Always Trust"')
    logger.info('')
    logger.info('Or run: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.navis/ca.crt')
  }

  /**
   * Get CA certificate
   */
  getCACertificate() {
    return this.caCert
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.certCache.clear()
    this.cacheTimestamps.clear()
    logger.info('Certificate cache cleared')
  }

  /**
   * List all cached certificates
   */
  listCertificates() {
    return Array.from(this.certCache.keys())
  }
}

export default CertificateManager

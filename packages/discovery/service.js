/**
 * Discovery Service
 * Orchestrates the entire discovery process: scanning, detection, and classification
 */

import { DiscoveryEngine } from './index.js'
import { detectorRegistry } from './detectors/index.js'
import { classificationEngine } from './classification.js'
import { getLogger } from '@navisai/logging'

const logger = getLogger('discovery-service')

export class DiscoveryService {
  constructor(options = {}) {
    this.engine = new DiscoveryEngine(options)
    this.detectors = detectorRegistry
    this.classifier = classificationEngine
    this.cache = new Map() // Simple in-memory cache
    this.cacheTimeout = options.cacheTimeout || 5 * 60 * 1000 // 5 minutes
  }

  /**
   * Discover and analyze a single project
   */
  async discoverProject(projectPath, options = {}) {
    const cacheKey = `${projectPath}:${JSON.stringify(options)}`

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        logger.debug(`Returning cached result for ${projectPath}`)
        return cached.result
      }
    }

    try {
      logger.info(`Discovering project at ${projectPath}`)

      // Step 1: Basic validation
      if (!await this.engine.validatePath(projectPath)) {
        throw new Error(`Invalid path: ${projectPath}`)
      }

      // Step 2: Detect project type
      const detectionResults = await this.detectors.detectAll(projectPath)

      if (!detectionResults.detected) {
        logger.warn(`No project type detected at ${projectPath}`)
        return {
          path: projectPath,
          detected: false,
          reason: 'No known project type detected'
        }
      }

      // Step 3: Collect signals
      const signals = await this.engine.collectSignals(projectPath)

      // Step 4: Classify project
      const classification = this.classifier.classify(detectionResults, signals)

      // Step 5: Build result
      const result = {
        id: this.engine.generateProjectId(projectPath),
        path: projectPath,
        name: this.engine.extractProjectName(projectPath),
        detected: true,
        detectedAt: new Date().toISOString(),

        // Detection info
        detection: {
          primary: detectionResults.primary,
          all: detectionResults.all,
          confidence: detectionResults.confidence
        },

        // Classification info
        classification: {
          primary: classification.primary,
          all: classification.all,
          language: classification.language,
          frameworks: classification.frameworks
        },

        // Signals
        signals: signals.slice(0, 50), // Limit signals

        // Metadata
        metadata: this._buildMetadata(detectionResults, classification, signals)
      }

      // Cache result
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        result
      })

      logger.info(`Discovered ${result.name} (${classification.primary?.name || 'Unknown'})`)
      return result

    } catch (error) {
      logger.error(`Discovery failed for ${projectPath}:`, error)
      return {
        path: projectPath,
        detected: false,
        error: error.message
      }
    }
  }

  /**
   * Discover all projects in a directory
   */
  async discoverProjects(directory, options = {}) {
    try {
      logger.info(`Scanning directory ${directory} for projects`)

      const projectPaths = await this.engine.scanDirectory(directory, {
        depth: options.depth || 3,
        exclude: options.exclude || [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/target/**'
        ]
      })

      logger.info(`Found ${projectPaths.length} potential projects`)

      // Discover each project (with concurrency control)
      const concurrency = options.concurrency || 5
      const results = []

      for (let i = 0; i < projectPaths.length; i += concurrency) {
        const batch = projectPaths.slice(i, i + concurrency)
        const batchResults = await Promise.allSettled(
          batch.map(path => this.discoverProject(path, options))
        )

        batchResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value.detected) {
            results.push(result.value)
          } else if (result.status === 'rejected') {
            logger.warn(`Batch discovery failed:`, result.reason)
          }
        })
      }

      logger.info(`Successfully discovered ${results.length} projects`)
      return results

    } catch (error) {
      logger.error(`Directory discovery failed for ${directory}:`, error)
      throw error
    }
  }

  /**
   * Refresh discovery for a path (bypass cache)
   */
  async refreshProject(projectPath, options = {}) {
    // Clear cache for this path
    const keysToDelete = Array.from(this.cache.keys()).filter(key =>
      key.startsWith(projectPath)
    )
    keysToDelete.forEach(key => this.cache.delete(key))

    return this.discoverProject(projectPath, options)
  }

  /**
   * Get cached discovery result
   */
  getCachedResult(projectPath) {
    const cached = this.cache.get(projectPath)
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result
    }
    return null
  }

  /**
   * Clear all cache
   */
  clearCache() {
    this.cache.clear()
    logger.info('Discovery cache cleared')
  }

  /**
   * Build comprehensive metadata
   */
  _buildMetadata(detectionResults, classification, signals) {
    const metadata = {
      tags: this._extractTags(detectionResults, classification, signals),
      size: this._estimateProjectSize(signals),
      complexity: this._estimateComplexity(detectionResults, signals),
      lastModified: this._getLastModified(signals)
    }

    // Add framework-specific metadata
    if (detectionResults.primary) {
      metadata.framework = detectionResults.primary.detector
      metadata.frameworkConfidence = detectionResults.primary.confidence

      // Merge detector metadata
      Object.assign(metadata, detectionResults.primary.metadata)
    }

    return metadata
  }

  /**
   * Extract tags from results
   */
  _extractTags(detectionResults, classification, signals) {
    const tags = new Set()

    // Add language tags
    if (classification.language) {
      tags.add(classification.language)
    }

    // Add framework tags
    classification.frameworks.forEach(fw => tags.add(fw))

    // Add category tags
    if (classification.primary) {
      tags.add(classification.primary.id)
    }

    // Add signal-based tags
    signals.forEach(signal => {
      const lower = signal.toLowerCase()
      if (lower.includes('test')) tags.add('has-tests')
      if (lower.includes('docker')) tags.add('dockerized')
      if (lower.includes('ci/cd') || lower.includes('github actions')) tags.add('ci-cd')
      if (lower.includes('typescript')) tags.add('typescript')
    })

    return Array.from(tags)
  }

  /**
   * Estimate project size from signals
   */
  _estimateProjectSize(signals) {
    const fileCountSignals = signals.filter(s => s.includes('files'))
    const sizeSignals = signals.filter(s => s.includes('MB') || s.includes('KB'))

    // Simple heuristic based on signal count
    if (signals.length > 100) return 'large'
    if (signals.length > 50) return 'medium'
    return 'small'
  }

  /**
   * Estimate project complexity
   */
  _estimateComplexity(detectionResults, signals) {
    let complexity = 0

    // Framework count
    complexity += detectionResults.all.length * 0.2

    // Dependencies
    const depSignals = signals.filter(s => s.includes('dependencies:'))
    depSignals.forEach(signal => {
      const count = parseInt(signal.split(':')[1]) || 0
      complexity += Math.min(count / 50, 1) * 0.3
    })

    // Configuration files
    const configSignals = signals.filter(s => s.includes('config') || s.includes('.'))
    complexity += configSignals.length * 0.1

    if (complexity > 1) return 'high'
    if (complexity > 0.5) return 'medium'
    return 'low'
  }

  /**
   * Extract last modified date from signals
   */
  _getLastModified(signals) {
    const modifiedSignal = signals.find(s => s.includes('last modified'))
    return modifiedSignal?.split(': ')[1] || null
  }
}

// Export singleton instance
export const discoveryService = new DiscoveryService()

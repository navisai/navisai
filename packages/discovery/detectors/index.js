/**
 * Detector Registry
 * Manages all project detectors and provides a unified interface for detection
 */

import { NodeJSDetector } from './nodejs.js'
import { PythonDetector } from './python.js'
import { GoDetector } from './go.js'
import { RustDetector } from './rust.js'
import { SvelteDetector, ReactDetector, VueDetector, AngularDetector } from './web.js'

export class DetectorRegistry {
  constructor() {
    this.detectors = new Map()
    this._registerDefaultDetectors()
  }

  _registerDefaultDetectors() {
    // Core language detectors
    this.register(new NodeJSDetector())
    this.register(new PythonDetector())
    this.register(new GoDetector())
    this.register(new RustDetector())

    // Web framework detectors
    this.register(new SvelteDetector())
    this.register(new ReactDetector())
    this.register(new VueDetector())
    this.register(new AngularDetector())
  }

  /**
   * Register a new detector
   */
  register(detector) {
    if (!detector.name || typeof detector.detect !== 'function') {
      throw new Error('Detector must have a name and detect method')
    }
    this.detectors.set(detector.name, detector)
  }

  /**
   * Get a detector by name
   */
  get(name) {
    return this.detectors.get(name)
  }

  /**
   * Get all registered detectors
   */
  getAll() {
    return Array.from(this.detectors.values())
  }

  /**
   * Run all detectors on a project path
   */
  async detectAll(projectPath) {
    const results = []

    for (const detector of this.detectors.values()) {
      try {
        const result = await detector.detect(projectPath)
        if (result.detected) {
          results.push({
            detector: detector.name,
            confidence: result.confidence,
            signals: result.signals || [],
            metadata: result.metadata || {}
          })
        }
      } catch (error) {
        console.warn(`Detector ${detector.name} failed:`, error.message)
      }
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence)

    return {
      detected: results.length > 0,
      primary: results[0] || null,
      all: results,
      confidence: results[0]?.confidence || 0
    }
  }

  /**
   * Get detectors for a specific category
   */
  getByCategory(category) {
    const categories = {
      'language': ['nodejs', 'python', 'go', 'rust'],
      'web': ['svelte', 'react', 'vue', 'angular'],
      'mobile': ['react-native', 'flutter', 'cordova'],
      'desktop': ['electron', 'tauri', 'wails']
    }

    const detectorNames = categories[category] || []
    return detectorNames
      .map(name => this.detectors.get(name))
      .filter(Boolean)
  }
}

// Export singleton instance
export const detectorRegistry = new DetectorRegistry()

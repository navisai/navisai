/**
 * Node.js Project Detector
 * Detects Node.js projects by looking for package.json, node_modules, yarn.lock, etc.
 */

import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export class NodeJSDetector {
  constructor() {
    this.name = 'nodejs'
    this.confidence = 0.9
    this.indicators = [
      { file: 'package.json', required: true, weight: 1.0 },
      { file: 'yarn.lock', weight: 0.3 },
      { file: 'package-lock.json', weight: 0.3 },
      { file: 'pnpm-lock.yaml', weight: 0.3 },
      { file: 'node_modules', required: false, weight: 0.2, isDirectory: true },
      { file: '.nvmrc', weight: 0.2 },
      { file: '.npmrc', weight: 0.2 },
      { file: '.node-version', weight: 0.2 }
    ]
  }

  async detect(projectPath) {
    try {
      let score = 0
      let maxScore = 0
      const signals = []

      // Check for package.json first (required)
      const packageJsonPath = join(projectPath, 'package.json')
      try {
        await access(packageJsonPath)
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

        // Add signals from package.json
        if (packageJson.name) signals.push(`name: ${packageJson.name}`)
        if (packageJson.version) signals.push(`version: ${packageJson.version}`)
        if (packageJson.scripts && Object.keys(packageJson.scripts).length > 0) {
          signals.push(`scripts: ${Object.keys(packageJson.scripts).join(', ')}`)
        }
        if (packageJson.dependencies) {
          const deps = Object.keys(packageJson.dependencies)
          signals.push(`dependencies: ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? '...' : ''}`)
        }

        score += 1.0
      } catch {
        return { detected: false, confidence: 0 }
      }

      // Check other indicators
      for (const indicator of this.indicators.slice(1)) {
        maxScore += indicator.weight

        try {
          const indicatorPath = join(projectPath, indicator.file)
          await access(indicatorPath)
          score += indicator.weight
          signals.push(`has ${indicator.file}`)
        } catch {
          // File doesn't exist, skip
        }
      }

      maxScore += 1.0 // For package.json
      const confidence = Math.min(score / (maxScore || 1), 1.0)

      return {
        detected: confidence > 0.3, // Lower threshold since package.json is required
        confidence,
        signals,
        metadata: {
          framework: 'nodejs',
          hasPackageJson: true
        }
      }
    } catch (error) {
      return { detected: false, confidence: 0, error: error.message }
    }
  }
}

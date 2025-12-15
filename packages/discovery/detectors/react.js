/**
 * React Project Detector
 * Detects React projects by looking for React dependencies and specific file patterns
 */

import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export class ReactDetector {
  constructor() {
    this.name = 'react'
    this.confidence = 0.9
    this.indicators = [
      { file: 'public/index.html', weight: 0.6 },
      { file: 'src/App.js', weight: 0.6 },
      { file: 'src/App.jsx', weight: 0.6 },
      { file: 'src/App.tsx', weight: 0.6 },
      { file: 'src/index.js', weight: 0.4 },
      { file: 'src/index.jsx', weight: 0.4 },
      { file: 'src/index.tsx', weight: 0.4 }
    ]
  }

  async detect(projectPath) {
    try {
      let score = 0
      let maxScore = 0
      const signals = []
      const metadata = { framework: 'react' }

      // Check for React files
      const hasReactFiles = await this._hasReactFiles(projectPath)
      if (hasReactFiles) {
        signals.push('has React/JSX/TSX files')
        score += 0.2
      }

      // Check file indicators
      for (const indicator of this.indicators) {
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

      // Check package.json for React dependencies
      try {
        const packageJsonPath = join(projectPath, 'package.json')
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        const reactDeps = Object.keys(deps).filter(dep =>
          dep.startsWith('react') ||
          dep.startsWith('@react') ||
          dep === 'react-dom' ||
          dep.includes('react')
        )

        if (reactDeps.length > 0) {
          score += 1.0
          signals.push(`React deps: ${reactDeps.join(', ')}`)
          metadata.dependencies = reactDeps

          // Detect specific frameworks
          if (deps['next'] || deps['@next']) {
            metadata.isNextJS = true
            signals.push('Next.js detected')
            score += 0.5
          }
          if (deps['gatsby'] || deps['@gatsby']) {
            metadata.isGatsby = true
            signals.push('Gatsby detected')
          }
          if (deps['remix']) {
            metadata.isRemix = true
            signals.push('Remix detected')
          }
        }
      } catch {
        // No package.json or invalid JSON
      }

      maxScore = Math.max(maxScore, 1.0) // Ensure we have a denominator
      const confidence = Math.min(score / maxScore, 1.0)

      return {
        detected: confidence > 0.4,
        confidence,
        signals,
        metadata
      }
    } catch (error) {
      return { detected: false, confidence: 0, error: error.message }
    }
  }

  async _hasReactFiles(projectPath) {
    try {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(projectPath, { withFileTypes: true, recursive: true })

      for (const entry of entries) {
        if (entry.isFile() && (
          entry.name.endsWith('.jsx') ||
          entry.name.endsWith('.tsx') ||
          entry.name.includes('React') ||
          entry.name.includes('react')
        )) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }
}

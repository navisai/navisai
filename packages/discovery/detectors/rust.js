/**
 * Rust Project Detector
 * Detects Rust projects by looking for Cargo.toml, Cargo.lock, src/main.rs, etc.
 */

import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export class RustDetector {
  constructor() {
    this.name = 'rust'
    this.confidence = 0.95
    this.indicators = [
      { file: 'Cargo.toml', weight: 1.0 },
      { file: 'Cargo.lock', weight: 0.6 },
      { file: 'src/main.rs', weight: 0.8 },
      { file: 'src/lib.rs', weight: 0.8 },
      { file: 'rust-toolchain.toml', weight: 0.3 },
      { file: '.rustfmt.toml', weight: 0.2 }
    ]
  }

  async detect(projectPath) {
    try {
      let score = 0
      let maxScore = 0
      const signals = []
      const metadata = { framework: 'rust' }

      // Check indicators
      for (const indicator of this.indicators) {
        maxScore += indicator.weight

        try {
          const indicatorPath = join(projectPath, indicator.file)
          await access(indicatorPath)
          score += indicator.weight
          signals.push(`has ${indicator.file}`)

          // Extract metadata from Cargo.toml
          if (indicator.file === 'Cargo.toml') {
            try {
              const content = await readFile(indicatorPath, 'utf8')
              const packageSection = this._parseCargoToml(content)

              if (packageSection.name) {
                metadata.name = packageSection.name
                signals.push(`package: ${packageSection.name}`)
              }
              if (packageSection.version) {
                metadata.version = packageSection.version
                signals.push(`version: ${packageSection.version}`)
              }
              if (packageSection.description) {
                metadata.description = packageSection.description
              }
              if (packageSection.edition) {
                metadata.edition = packageSection.edition
                signals.push(`edition: ${packageSection.edition}`)
              }
            } catch {
              // Couldn't parse, skip
            }
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      const confidence = Math.min(score / (maxScore || 1), 1.0)

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

  _parseCargoToml(content) {
    // Simple TOML parser for [package] section
    const result = {}
    const lines = content.split('\n')
    let inPackageSection = false

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed === '[package]') {
        inPackageSection = true
        continue
      }

      if (trimmed.startsWith('[') && trimmed !== '[package]') {
        inPackageSection = false
        continue
      }

      if (inPackageSection && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=')
        const value = valueParts.join('=').trim()
        result[key.trim()] = value.replace(/["']/g, '')
      }
    }

    return result
  }
}

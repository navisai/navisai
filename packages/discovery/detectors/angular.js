/**
 * Angular Project Detector
 * Detects Angular projects by looking for Angular CLI files and dependencies
 */

import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export class AngularDetector {
  constructor() {
    this.name = 'angular'
    this.confidence = 0.95
    this.indicators = [
      { file: 'angular.json', weight: 1.0 },
      { file: 'ng-package.json', weight: 0.8 },
      { file: 'src/app/app.component.ts', weight: 0.8 },
      { file: 'src/app/app.module.ts', weight: 0.8 },
      { file: 'src/index.html', weight: 0.4 },
      { file: 'tsconfig.app.json', weight: 0.6 },
      { file: '.angular', weight: 0.3, isDirectory: true }
    ]
  }

  async detect(projectPath) {
    try {
      let score = 0
      let maxScore = 0
      const signals = []
      const metadata = { framework: 'angular' }

      // Check indicators
      for (const indicator of this.indicators) {
        maxScore += indicator.weight

        try {
          const indicatorPath = join(projectPath, indicator.file)
          await access(indicatorPath)
          score += indicator.weight
          signals.push(`has ${indicator.file}`)

          // Extract metadata from angular.json
          if (indicator.file === 'angular.json') {
            try {
              const content = await readFile(indicatorPath, 'utf8')
              const angularConfig = JSON.parse(content)

              if (angularConfig.defaultProject) {
                metadata.defaultProject = angularConfig.defaultProject
                signals.push(`project: ${angularConfig.defaultProject}`)
              }

              const projects = Object.keys(angularConfig.projects || {})
              if (projects.length > 0) {
                metadata.projects = projects
                signals.push(`${projects.length} project(s)`)
              }
            } catch {
              // Couldn't parse, skip
            }
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      // Check package.json for Angular dependencies
      try {
        const packageJsonPath = join(projectPath, 'package.json')
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        const angularDeps = Object.keys(deps).filter(dep =>
          dep.startsWith('@angular') ||
          dep === 'angular-cli' ||
          dep === '@angular/cli'
        )

        if (angularDeps.length > 0) {
          score += 1.0
          signals.push(`Angular deps: ${angularDeps.join(', ')}`)
          metadata.dependencies = angularDeps

          // Get Angular version
          const angularCore = deps['@angular/core']
          if (angularCore) {
            metadata.version = angularCore.replace('^', '').replace('~', '')
            signals.push(`Angular ${metadata.version}`)
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
}

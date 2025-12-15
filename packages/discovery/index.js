import { promises as fsPromises } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectsRepo } from '@navisai/db/repositories.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class DiscoveryEngine {
  constructor(db) {
    this.db = db
    this.detectors = []
    this.classifiers = []
  }

  /**
   * Register a project detector
   * @param {string} name - Detector name
   * @param {Function} detector - Detector function that returns confidence score
   * @param {string[]} patterns - File patterns to look for
   */
  registerDetector(name, detector, patterns = []) {
    this.detectors.push({ name, detector, patterns })
  }

  /**
   * Register a project classifier
   * @param {string} name - Classifier name
   * @param {Function} classifier - Classification function
   */
  registerClassifier(name, classifier) {
    this.classifiers.push({ name, classifier })
  }

  /**
   * Scan a directory for projects
   * @param {string} scanPath - Directory to scan (defaults to cwd)
   * @param {Object} options - Scan options
   * @returns {Promise<Object[]>} - List of discovered projects
   */
  async scan(scanPath = process.cwd(), options = {}) {
    const {
      maxDepth = 5,
      excludeDirs = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage'],
      excludeFiles = ['package-lock.json', 'yarn.lock', '.DS_Store', 'Thumbs.db'],
    } = options

    try {
      const projects = []
      const visitedDirs = new Set()

      await this.scanDirectory(scanPath, projects, visitedDirs, maxDepth, excludeDirs, excludeFiles)
      return projects
    } catch (error) {
      console.error(`Scan failed for ${scanPath}:`, error)
      throw error
    }
  }

  /**
   * Recursively scan directory for projects
   */
  async scanDirectory(dirPath, projects, visitedDirs, maxDepth, excludeDirs, excludeFiles, depth = 0) {
    if (depth > maxDepth || visitedDirs.has(dirPath)) {
      return
    }

    visitedDirs.add(dirPath)

    try {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })

      // Check if this is a project directory
      if (await this.isProjectDirectory(dirPath, entries)) {
        const project = await this.analyzeProject(dirPath)
        if (project) {
          projects.push(project)
        }
        return // Don't scan deeper into project directories
      }

      // Recursively scan subdirectories
      const dirs = entries.filter(entry =>
        entry.isDirectory() &&
        !excludeDirs.includes(entry.name) &&
        !entry.name.startsWith('.')
      )

      for (const dir of dirs) {
        await this.scanDirectory(
          path.join(dirPath, dir.name),
          projects,
          visitedDirs,
          maxDepth,
          excludeDirs,
          excludeFiles,
          depth + 1
        )
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
        console.error(`Error scanning ${dirPath}:`, error)
      }
    }
  }

  /**
   * Check if a directory contains a project
   */
  async isProjectDirectory(dirPath, entries) {
    // Look for package.json (strongest signal)
    if (entries.some(entry => entry.name === 'package.json')) {
      return true
    }

    // Look for project files by detector patterns
    for (const detector of this.detectors) {
      for (const pattern of detector.patterns) {
        if (entries.some(entry => this.matchesPattern(entry.name, pattern))) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Analyze a project directory
   */
  async analyzeProject(projectPath) {
    try {
      const signals = []
      let projectInfo = {
        path: projectPath,
        name: path.basename(projectPath),
        signals: [],
        classification: null,
        confidence: 0,
        lastScanned: new Date().toISOString(),
      }

      // Run all detectors
      for (const detector of this.detectors) {
        const confidence = await detector.detector(projectPath)
        if (confidence > 0) {
          signals.push({
            type: detector.name,
            confidence,
            path: projectPath,
          })
          projectInfo.confidence = Math.max(projectInfo.confidence, confidence)
        }
      }

      // Only continue if we have signals
      if (signals.length === 0) {
        return null
      }

      // Read package.json if it exists
      try {
        const packageJsonPath = path.join(projectPath, 'package.json')
        const packageJsonContent = await fsPromises.readFile(packageJsonPath, 'utf-8')
        const packageJson = JSON.parse(packageJsonContent)

        projectInfo.name = packageJson.name || projectInfo.name
        projectInfo.packageJson = {
          name: packageJson.name,
          version: packageJson.version,
          scripts: Object.keys(packageJson.scripts || {}),
          dependencies: Object.keys(packageJson.dependencies || {}),
          devDependencies: Object.keys(packageJson.devDependencies || {}),
        }
      } catch (error) {
        // package.json might not exist or be invalid
        projectInfo.packageJson = null
      }

      // Run classifiers
      let classification = {}
      for (const classifier of this.classifiers) {
        const result = await classifier.classifier(projectPath, projectInfo.signals, projectInfo.packageJson)
        if (result) {
          classification = { ...classification, ...result }
        }
      }

      projectInfo.signals = signals
      projectInfo.classification = classification

      return projectInfo
    } catch (error) {
      console.error(`Failed to analyze project ${projectPath}:`, error)
      return null
    }
  }

  /**
   * Save discovered projects to database
   */
  async saveProjects(discoveredProjects) {
    if (!this.db.isAvailable()) {
      console.warn('Database not available, projects will not be persisted')
      return
    }

    for (const project of discoveredProjects) {
      try {
        // Check if project already exists
        const existing = await projectsRepo.findByPath(project.path)

        if (existing) {
          // Update existing project
          await projectsRepo.update(existing.id, {
            name: project.name,
            updatedAt: new Date().toISOString(),
          })
        } else {
          // Create new project
          await projectsRepo.create({
            path: project.path,
            name: project.name,
          })
        }
      } catch (error) {
        console.error(`Failed to save project ${project.path}:`, error)
      }
    }
  }

  /**
   * Simple pattern matching for detector patterns
   */
  matchesPattern(filename, pattern) {
    if (pattern.startsWith('*.')) {
      return filename === pattern.slice(1)
    } else if (pattern.includes('*')) {
      return filename.includes(pattern.replace('*', ''))
    } else if (pattern.endsWith('/*')) {
      return filename.startsWith(pattern.slice(0, -1))
    }
    return filename === pattern
  }

  /**
   * Get all registered detectors
   */
  getDetectors() {
    return this.detectors
  }

  /**
   * Get all registered classifiers
   */
  getClassifiers() {
    return this.classifiers
  }
}

// Export singleton instance
const discovery = new DiscoveryEngine()

// Export the class and the instance
export { DiscoveryEngine }
export default discovery

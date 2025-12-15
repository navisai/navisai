/**
 * Project Service
 * Manages discovered projects and their metadata
 */

export class ProjectService {
  constructor() {
    this.projects = new Map()
  }

  async initialize() {
    // Initialize project storage
    console.log('📁 Project service initialized')
  }

  async listProjects() {
    return {
      projects: Array.from(this.projects.values())
    }
  }

  async getProject(id) {
    const project = this.projects.get(id)
    if (!project) {
      throw new Error('Project not found')
    }
    return project
  }

  async addProject(project) {
    this.projects.set(project.id, project)
    return project
  }

  async updateProject(id, updates) {
    const project = this.projects.get(id)
    if (!project) {
      throw new Error('Project not found')
    }
    Object.assign(project, updates)
    return project
  }

  async removeProject(id) {
    const deleted = this.projects.delete(id)
    if (!deleted) {
      throw new Error('Project not found')
    }
    return true
  }
}

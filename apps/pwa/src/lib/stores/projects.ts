import { writable, derived } from 'svelte/store'
import { apiClient, type Project } from '$lib/api/client'

interface ProjectsState {
  projects: Project[]
  loading: boolean
  error: string | null
  scanning: boolean
}

function createProjectsStore() {
  const { subscribe, set, update } = writable<ProjectsState>({
    projects: [],
    loading: true,
    error: null,
    scanning: false,
  })

  const loadProjects = async () => {
    try {
      update(state => ({ ...state, loading: true, error: null }))
      const projects = await apiClient.getProjects()
      update(state => ({
        ...state,
        projects,
        loading: false,
      }))
    } catch (error) {
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Failed to load projects',
        loading: false,
      }))
    }
  }

  const scanDirectory = async (path: string, options?: any) => {
    try {
      update(state => ({ ...state, scanning: true, error: null }))
      const result = await apiClient.scanDirectory(path, options)

      // Refresh projects after successful scan
      await loadProjects()

      update(state => ({ ...state, scanning: false }))
      return result
    } catch (error) {
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Scan failed',
        scanning: false,
      }))
      throw error
    }
  }

  const getProject = async (id: string): Promise<Project> => {
    try {
      const project = await apiClient.getProject(id)

      // Update project in store if it exists
      update(state => ({
        ...state,
        projects: state.projects.map(p => (p.id === id ? project : p)),
      }))

      return project
    } catch (error) {
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Failed to fetch project',
      }))
      throw error
    }
  }

  const analyzeProject = async (path: string, refresh = false) => {
    try {
      const project = await apiClient.getProjectAnalysis(path, refresh)

      // Update or add project in store
      update(state => ({
        ...state,
        projects: state.projects.some(p => p.id === project.id)
          ? state.projects.map(p => (p.id === project.id ? project : p))
          : [...state.projects, project],
      }))

      return project
    } catch (error) {
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Failed to analyze project',
      }))
      throw error
    }
  }

  const indexPaths = async (paths: string[]) => {
    try {
      update(state => ({ ...state, scanning: true, error: null }))
      const result = await apiClient.indexPaths(paths)

      // Refresh projects after indexing
      await loadProjects()

      update(state => ({ ...state, scanning: false }))
      return result
    } catch (error) {
      update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Indexing failed',
        scanning: false,
      }))
      throw error
    }
  }

  const clearError = () => {
    update(state => ({ ...state, error: null }))
  }

  // Listen for discovery updates from WebSocket
  apiClient.on('discovery_completed', data => {
    update(state => ({
      ...state,
      scanning: false,
    }))
    // Refresh projects to get latest data
    loadProjects()
  })

  return {
    subscribe,
    loadProjects,
    scanDirectory,
    getProject,
    analyzeProject,
    indexPaths,
    clearError,
  }
}

export const projectsStore = createProjectsStore()

// Derived stores
export const projects = derived(projectsStore, $projects => $projects.projects)
export const isLoadingProjects = derived(projectsStore, $projects => $projects.loading)
export const projectsError = derived(projectsStore, $projects => $projects.error)
export const isScanning = derived(projectsStore, $projects => $projects.scanning)

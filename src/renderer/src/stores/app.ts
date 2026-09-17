import { create } from 'zustand'
import type { AppInfo } from '@shared/ipc'
import {
  DEFAULT_SETTINGS,
  type IndexProgress,
  type IndexReport,
  type ModelStatus,
  type ProjectSummary,
  type Result,
  type Settings
} from '@shared/types'

export type Route = 'dashboard' | 'chat' | 'documents' | 'history' | 'models' | 'settings'

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

const INITIAL_MODEL_STATUS: ModelStatus = {
  state: 'unloaded',
  provider: 'none',
  model: '',
  detail: '',
  contextSize: 0,
  lastError: null
}

export interface ViewerTarget {
  documentId: number
  sectionId: number | null
}

interface AppState {
  ready: boolean
  info: AppInfo | null
  project: ProjectSummary | null
  projects: ProjectSummary[]
  settings: Settings
  modelStatus: ModelStatus
  route: Route
  indexing: IndexProgress | null
  lastReport: IndexReport | null
  busy: boolean
  error: string | null
  viewer: ViewerTarget | null

  bootstrap: () => Promise<void>
  openFolder: () => Promise<void>
  selectProject: (projectId: number) => Promise<void>
  removeProject: (projectId: number) => Promise<void>
  reindex: () => Promise<void>
  refreshProject: () => Promise<void>
  setRoute: (route: Route) => void
  openViewer: (target: ViewerTarget) => void
  closeViewer: () => void
  setModelStatus: (status: ModelStatus) => void
  refreshModelStatus: () => Promise<void>
  refreshSettings: () => Promise<void>
  setIndexing: (progress: IndexProgress | null) => void
  updateSettings: (patch: unknown) => Promise<void>
  setError: (error: string | null) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  info: null,
  project: null,
  projects: [],
  settings: DEFAULT_SETTINGS,
  modelStatus: INITIAL_MODEL_STATUS,
  route: 'chat',
  indexing: null,
  lastReport: null,
  busy: false,
  error: null,
  viewer: null,

  async bootstrap() {
    try {
      const [info, settings, project, projects, modelStatus] = await Promise.all([
        window.docmind.app.info().then(unwrap),
        window.docmind.settings.get().then(unwrap),
        window.docmind.projects.current().then(unwrap),
        window.docmind.projects.list().then(unwrap),
        window.docmind.models.status().then(unwrap)
      ])
      set({ info, settings, project, projects, modelStatus, ready: true })
      if (project && settings.general.reindexOnOpen) void get().reindex()
    } catch (error) {
      set({ ready: true, error: (error as Error).message })
    }
  },

  async openFolder() {
    set({ busy: true, error: null, indexing: null })
    try {
      const project = await window.docmind.projects.openDialog().then(unwrap)
      if (project) {
        const projects = await window.docmind.projects.list().then(unwrap)
        set({ project, projects, route: 'dashboard' })
      }
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ busy: false, indexing: null })
    }
  },

  async selectProject(projectId) {
    set({ busy: true, error: null })
    try {
      const project = await window.docmind.projects.select(projectId).then(unwrap)
      set({ project, route: 'dashboard' })
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ busy: false })
    }
  },

  async removeProject(projectId) {
    try {
      await window.docmind.projects.remove(projectId).then(unwrap)
      const [projects, project] = await Promise.all([
        window.docmind.projects.list().then(unwrap),
        window.docmind.projects.current().then(unwrap)
      ])
      set({ projects, project })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  async reindex() {
    const project = get().project
    if (!project) return
    set({ busy: true, error: null })
    try {
      const report = await window.docmind.projects.reindex(project.id).then(unwrap)
      set({ lastReport: report })
      await get().refreshProject()
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ busy: false, indexing: null })
    }
  },

  async refreshProject() {
    try {
      const [project, projects] = await Promise.all([
        window.docmind.projects.current().then(unwrap),
        window.docmind.projects.list().then(unwrap)
      ])
      set({ project, projects })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  setRoute: (route) => set({ route, viewer: null }),
  openViewer: (viewer) => set({ viewer }),
  closeViewer: () => set({ viewer: null }),
  setModelStatus: (modelStatus) => set({ modelStatus }),

  async refreshModelStatus() {
    try {
      set({ modelStatus: await window.docmind.models.status().then(unwrap) })
    } catch {
      /* the toolbar simply keeps the previous status */
    }
  },

  async refreshSettings() {
    try {
      set({ settings: await window.docmind.settings.get().then(unwrap) })
    } catch {
      /* keep the settings already in memory */
    }
  },

  setIndexing: (indexing) => set({ indexing }),

  async updateSettings(patch) {
    try {
      const settings = await window.docmind.settings.update(patch).then(unwrap)
      set({ settings })
      await get().refreshModelStatus()
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  setError: (error) => set({ error })
}))

import path from 'node:path'
import { app } from 'electron'
import { openDatabase, type DocMindDb } from './database/client'
import { readSetting, writeSetting } from './database/repositories'
import { ModelManager } from './llm/manager'
import { loadSettings, saveSettings } from './settings'
import type { Settings } from '@shared/types'

const CURRENT_PROJECT_KEY = 'app.currentProjectId'

export interface Services {
  db: DocMindDb
  models: ModelManager
  settings(): Settings
  updateSettings(patch: unknown): Promise<Settings>
  currentProjectId(): number | null
  setCurrentProjectId(id: number | null): void
  databasePath: string
}

export function resolveDatabasePath(): string {
  // In development the DB lives inside the repo so it can be inspected with
  // any SQLite client; packaged builds use the per-user app data folder.
  if (!app.isPackaged) return path.join(app.getAppPath(), 'data', 'docmind.db')
  return path.join(app.getPath('userData'), 'docmind.db')
}

export function createServices(databasePath = resolveDatabasePath()): Services {
  const db = openDatabase(databasePath)
  let settings = loadSettings(db)
  const models = new ModelManager(settings.model)

  return {
    db,
    models,
    databasePath,
    settings: () => settings,
    async updateSettings(patch: unknown) {
      settings = saveSettings(db, patch)
      await models.applySettings(settings.model)
      return settings
    },
    currentProjectId() {
      const raw = readSetting(db, CURRENT_PROJECT_KEY)
      const id = raw ? Number(raw) : Number.NaN
      return Number.isInteger(id) ? id : null
    },
    setCurrentProjectId(id: number | null) {
      writeSetting(db, CURRENT_PROJECT_KEY, id === null ? '' : String(id))
    }
  }
}

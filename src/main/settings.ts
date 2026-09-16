import type { DocMindDb } from './database/client'
import { readSetting, writeSetting } from './database/repositories'
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@shared/types'

const KEY = 'app.settings'

export function loadSettings(db: DocMindDb): Settings {
  const raw = readSetting(db, KEY)
  if (!raw) return DEFAULT_SETTINGS
  try {
    return settingsSchema.parse(JSON.parse(raw))
  } catch {
    // Corrupted or outdated settings must never keep the app from starting.
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(db: DocMindDb, patch: unknown): Settings {
  const current = loadSettings(db)
  const merged = mergeDeep(current, patch)
  const parsed = settingsSchema.parse(merged)
  writeSetting(db, KEY, JSON.stringify(parsed))
  return parsed
}

type Plain = Record<string, unknown>

function isPlainObject(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeDeep(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch
  const result: Plain = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in base ? mergeDeep(base[key], value) : value
  }
  return result
}

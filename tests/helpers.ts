import path from 'node:path'
import { openDatabase, type DocMindDb } from '@main/database/client'
import { upsertProject } from '@main/database/repositories'
import { indexProject } from '@main/ingestion/indexer'
import { DEFAULT_SETTINGS } from '@shared/types'

export const DEMO_ROOT = path.resolve(import.meta.dirname, '..', 'demo', 'example-project')

export function memoryDb(): DocMindDb {
  return openDatabase(':memory:')
}

export async function indexedDemo(db: DocMindDb = memoryDb()): Promise<{ db: DocMindDb; projectId: number }> {
  const project = upsertProject(db, DEMO_ROOT, 'example-project')
  await indexProject(db, { projectId: project.id, root: DEMO_ROOT, settings: DEFAULT_SETTINGS.general })
  return { db, projectId: project.id }
}

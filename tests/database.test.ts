import { afterAll, describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { openDatabase } from '@main/database/client'
import { schema } from '@main/database/schema'
import {
  addMessage,
  createConversation,
  listConversations,
  listMessages,
  readSetting,
  upsertProject,
  writeSetting
} from '@main/database/repositories'
import { loadSettings, saveSettings } from '@main/settings'
import { DEFAULT_SETTINGS } from '@shared/types'
import { memoryDb } from './helpers'

const db = memoryDb()
afterAll(() => db.close())

describe('schema', () => {
  it('creates every table the product needs', () => {
    const tables = db.raw
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    for (const table of [
      'projects',
      'documents',
      'sections',
      'queries',
      'retrieval_results',
      'conversations',
      'messages',
      'settings',
      'sections_fts'
    ]) {
      expect(names).toContain(table)
    }
  })

  // The Drizzle model and the raw DDL are two files; this keeps them honest.
  it.each(Object.values(schema).map((table) => [getTableConfig(table).name, table] as const))(
    'drizzle model for %s matches the SQLite table',
    (name, table) => {
      const actual = (db.raw.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name)
      const expected = getTableConfig(table).columns.map((column) => column.name)
      expect(actual.sort()).toEqual(expected.sort())
    }
  )

  it('indexes the four searchable FTS columns', () => {
    const sql = (
      db.raw.prepare(`SELECT sql FROM sqlite_master WHERE name = 'sections_fts'`).get() as { sql: string }
    ).sql
    for (const column of ['filename', 'heading', 'heading_path', 'content']) {
      expect(sql).toContain(column)
    }
    expect(sql).toContain('tokenchars')
  })

  it('cascades deletes from project to sections', () => {
    const project = upsertProject(db, '/tmp/cascade-demo', 'cascade')
    db.raw
      .prepare(
        `INSERT INTO documents (project_id, relative_path, filename, hash, created_at, updated_at) VALUES (?, 'a.md', 'a.md', 'h', 0, 0)`
      )
      .run(project.id)
    const documentId = db.raw.prepare(`SELECT id FROM documents WHERE project_id = ?`).get(project.id) as { id: number }
    db.raw
      .prepare(
        `INSERT INTO sections (document_id, heading, heading_path, content, start_line, end_line, tokens, created_at) VALUES (?, 'h', 'h', 'c', 1, 2, 1, 0)`
      )
      .run(documentId.id)

    db.raw.prepare(`DELETE FROM projects WHERE id = ?`).run(project.id)
    const left = db.raw.prepare(`SELECT count(*) AS n FROM sections WHERE document_id = ?`).get(documentId.id) as {
      n: number
    }
    expect(left.n).toBe(0)
  })
})

describe('conversations', () => {
  it('stores messages with their sources and timings', () => {
    const project = upsertProject(db, '/tmp/conv-demo', 'conv')
    const conversationId = createConversation(db, project.id, 'Why is /me wrong?')
    addMessage(db, { conversationId, role: 'user', content: 'Why is /me wrong?' })
    addMessage(db, {
      conversationId,
      role: 'assistant',
      content: 'Because of the merge.',
      sources: [
        {
          sectionId: 1,
          documentId: 1,
          filename: '04-api-reference.md',
          relativePath: '04-api-reference.md',
          heading: 'GET /me',
          headingPath: 'API reference > GET /me',
          startLine: 1,
          endLine: 9,
          relevance: 0.91,
          excerpt: '…'
        }
      ],
      timings: { analysisMs: 1, searchMs: 2, rankingMs: 3, contextMs: 4, generationMs: 5, totalMs: 15 }
    })

    const messages = listMessages(db, conversationId)
    expect(messages).toHaveLength(2)
    expect(messages[1]?.sources[0]?.heading).toBe('GET /me')
    expect(messages[1]?.timings?.totalMs).toBe(15)
    expect(listConversations(db, project.id)[0]?.messageCount).toBe(2)
  })
})

describe('settings', () => {
  it('round-trips raw key/value entries', () => {
    writeSetting(db, 'k', 'v1')
    writeSetting(db, 'k', 'v2')
    expect(readSetting(db, 'k')).toBe('v2')
  })

  it('returns defaults when nothing has been saved', () => {
    const fresh = openDatabase(':memory:')
    expect(loadSettings(fresh)).toEqual(DEFAULT_SETTINGS)
    fresh.close()
  })

  it('deep merges partial updates and validates them', () => {
    const fresh = openDatabase(':memory:')
    const saved = saveSettings(fresh, { retrieval: { maxSections: 9 } })
    expect(saved.retrieval.maxSections).toBe(9)
    expect(saved.retrieval.maxContextChars).toBe(DEFAULT_SETTINGS.retrieval.maxContextChars)
    expect(saved.model.provider).toBe('none')
    expect(() => saveSettings(fresh, { retrieval: { maxSections: 999 } })).toThrow()
    fresh.close()
  })

  it('survives a corrupted settings row', () => {
    const fresh = openDatabase(':memory:')
    writeSetting(fresh, 'app.settings', 'not json')
    expect(loadSettings(fresh)).toEqual(DEFAULT_SETTINGS)
    fresh.close()
  })
})

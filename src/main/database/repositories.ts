import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DocMindDb } from './client'
import {
  conversations,
  documents,
  messages,
  projects,
  queries,
  retrievalResults,
  sections,
  settingsTable
} from './schema'
import type {
  ChatMessage,
  ConversationSummary,
  DocumentSummary,
  GenerationStats,
  ProjectStats,
  ProjectSummary,
  QueryAnalysis,
  RetrievedSection,
  SectionView,
  Source,
  Timings
} from '@shared/types'

const nowMs = (): number => Date.now()

/* ------------------------------ projects ------------------------------ */

export interface ProjectRow {
  id: number
  name: string
  path: string
  createdAt: number
  updatedAt: number
  lastIndexedAt: number | null
}

export function upsertProject(db: DocMindDb, projectPath: string, name: string): ProjectRow {
  const existing = db.orm.select().from(projects).where(eq(projects.path, projectPath)).get()
  if (existing) {
    db.orm.update(projects).set({ name, updatedAt: nowMs() }).where(eq(projects.id, existing.id)).run()
    return { ...existing, name, updatedAt: nowMs() }
  }
  const ts = nowMs()
  const inserted = db.orm
    .insert(projects)
    .values({ name, path: projectPath, createdAt: ts, updatedAt: ts })
    .returning()
    .get()
  return inserted
}

export function getProject(db: DocMindDb, id: number): ProjectRow | undefined {
  return db.orm.select().from(projects).where(eq(projects.id, id)).get()
}

export function markIndexed(db: DocMindDb, projectId: number): void {
  const ts = nowMs()
  db.orm.update(projects).set({ lastIndexedAt: ts, updatedAt: ts }).where(eq(projects.id, projectId)).run()
}

export function projectStats(db: DocMindDb, projectId: number): ProjectStats {
  const row = db.raw
    .prepare(
      `SELECT
         (SELECT count(*) FROM documents WHERE project_id = ?) AS documents,
         (SELECT count(*) FROM sections s JOIN documents d ON d.id = s.document_id WHERE d.project_id = ?) AS sections,
         (SELECT coalesce(sum(word_count), 0) FROM documents WHERE project_id = ?) AS words,
         (SELECT last_indexed_at FROM projects WHERE id = ?) AS lastIndexedAt`
    )
    .get(projectId, projectId, projectId, projectId) as ProjectStats
  return row
}

export function listProjects(db: DocMindDb): ProjectSummary[] {
  return db.orm
    .select()
    .from(projects)
    .orderBy(desc(projects.updatedAt))
    .all()
    .map((p) => ({ ...p, stats: projectStats(db, p.id) }))
}

export function deleteProject(db: DocMindDb, projectId: number): void {
  db.raw.prepare(`DELETE FROM sections_fts WHERE project_id = ?`).run(projectId)
  db.orm.delete(projects).where(eq(projects.id, projectId)).run()
}

/* ------------------------------ documents ----------------------------- */

export interface DocumentRow {
  id: number
  relativePath: string
  filename: string
  hash: string
  wordCount: number
}

export function documentsByPath(db: DocMindDb, projectId: number): Map<string, DocumentRow> {
  const rows = db.orm
    .select({
      id: documents.id,
      relativePath: documents.relativePath,
      filename: documents.filename,
      hash: documents.hash,
      wordCount: documents.wordCount
    })
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .all()
  return new Map(rows.map((r) => [r.relativePath, r]))
}

export function listDocuments(db: DocMindDb, projectId: number): DocumentSummary[] {
  return db.raw
    .prepare(
      `SELECT d.id, d.relative_path AS relativePath, d.filename, d.word_count AS words,
              d.updated_at AS updatedAt,
              (SELECT count(*) FROM sections s WHERE s.document_id = d.id) AS sections
       FROM documents d WHERE d.project_id = ? ORDER BY d.relative_path`
    )
    .all(projectId) as DocumentSummary[]
}

export function deleteDocuments(db: DocMindDb, ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  db.raw.prepare(`DELETE FROM sections_fts WHERE document_id IN (${placeholders})`).run(...ids)
  db.orm.delete(documents).where(inArray(documents.id, ids)).run()
}

/* ------------------------------ sections ------------------------------ */

export interface SectionInput {
  ordinal: number
  level: number
  heading: string
  headingPath: string
  content: string
  startLine: number
  endLine: number
  tokens: number
}

/** Replaces every section of a document, keeping the FTS index in sync. */
export function replaceSections(
  db: DocMindDb,
  projectId: number,
  documentId: number,
  filename: string,
  inputs: SectionInput[]
): void {
  const ts = nowMs()
  const deleteFts = db.raw.prepare(`DELETE FROM sections_fts WHERE document_id = ?`)
  const insertSection = db.raw.prepare(
    `INSERT INTO sections (document_id, ordinal, level, heading, heading_path, content, start_line, end_line, tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertFts = db.raw.prepare(
    `INSERT INTO sections_fts (filename, heading, heading_path, content, section_id, document_id, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  db.raw.transaction(() => {
    deleteFts.run(documentId)
    db.raw.prepare(`DELETE FROM sections WHERE document_id = ?`).run(documentId)
    for (const s of inputs) {
      const info = insertSection.run(
        documentId,
        s.ordinal,
        s.level,
        s.heading,
        s.headingPath,
        s.content,
        s.startLine,
        s.endLine,
        s.tokens,
        ts
      )
      insertFts.run(
        filename,
        s.heading,
        s.headingPath,
        s.content,
        Number(info.lastInsertRowid),
        documentId,
        projectId
      )
    }
  })()
}

export function getSection(db: DocMindDb, sectionId: number): SectionView | undefined {
  return db.orm
    .select({
      id: sections.id,
      documentId: sections.documentId,
      heading: sections.heading,
      headingPath: sections.headingPath,
      content: sections.content,
      startLine: sections.startLine,
      endLine: sections.endLine,
      tokens: sections.tokens
    })
    .from(sections)
    .where(eq(sections.id, sectionId))
    .get()
}

export function listSections(db: DocMindDb, documentId: number): SectionView[] {
  return db.orm
    .select({
      id: sections.id,
      documentId: sections.documentId,
      heading: sections.heading,
      headingPath: sections.headingPath,
      content: sections.content,
      startLine: sections.startLine,
      endLine: sections.endLine,
      tokens: sections.tokens
    })
    .from(sections)
    .where(eq(sections.documentId, documentId))
    .orderBy(sections.ordinal)
    .all()
}

export function countSections(db: DocMindDb, projectId: number): number {
  const row = db.raw
    .prepare(
      `SELECT count(*) AS n FROM sections s JOIN documents d ON d.id = s.document_id WHERE d.project_id = ?`
    )
    .get(projectId) as { n: number }
  return row.n
}

/* --------------------------- queries & results ------------------------ */

export function recordQuery(
  db: DocMindDb,
  projectId: number,
  conversationId: number,
  analysis: QueryAnalysis,
  durationMs: number
): number {
  const row = db.orm
    .insert(queries)
    .values({
      projectId,
      conversationId,
      text: analysis.originalQuery,
      intent: analysis.intent,
      symbols: JSON.stringify(analysis.symbols),
      keywords: JSON.stringify(analysis.keywords),
      durationMs,
      createdAt: nowMs()
    })
    .returning({ id: queries.id })
    .get()
  return row.id
}

export function recordRetrieval(db: DocMindDb, queryId: number, ranked: RetrievedSection[]): void {
  if (ranked.length === 0) return
  const ts = nowMs()
  const stmt = db.raw.prepare(
    `INSERT INTO retrieval_results (query_id, section_id, rank, score, selected, breakdown, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  db.raw.transaction(() => {
    ranked.forEach((r, i) => {
      stmt.run(queryId, r.sectionId, i + 1, r.score, r.selected ? 1 : 0, JSON.stringify(r.breakdown), ts)
    })
  })()
}

export function retrievalForQuery(
  db: DocMindDb,
  queryId: number
): { sectionId: number; rank: number; score: number; selected: boolean }[] {
  return db.orm
    .select({
      sectionId: retrievalResults.sectionId,
      rank: retrievalResults.rank,
      score: retrievalResults.score,
      selected: retrievalResults.selected
    })
    .from(retrievalResults)
    .where(eq(retrievalResults.queryId, queryId))
    .orderBy(retrievalResults.rank)
    .all()
    .map((r) => ({ ...r, selected: r.selected === 1 }))
}

/* --------------------------- conversations ---------------------------- */

export function createConversation(db: DocMindDb, projectId: number, title: string): number {
  const ts = nowMs()
  return db.orm
    .insert(conversations)
    .values({ projectId, title: title.slice(0, 120), createdAt: ts, updatedAt: ts })
    .returning({ id: conversations.id })
    .get().id
}

export function touchConversation(db: DocMindDb, conversationId: number): void {
  db.orm.update(conversations).set({ updatedAt: nowMs() }).where(eq(conversations.id, conversationId)).run()
}

export function listConversations(db: DocMindDb, projectId: number): ConversationSummary[] {
  return db.raw
    .prepare(
      `SELECT c.id, c.project_id AS projectId, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt,
              (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount
       FROM conversations c WHERE c.project_id = ? ORDER BY c.updated_at DESC`
    )
    .all(projectId) as ConversationSummary[]
}

export function deleteConversation(db: DocMindDb, conversationId: number): void {
  db.orm.delete(conversations).where(eq(conversations.id, conversationId)).run()
}

export interface MessageInput {
  conversationId: number
  role: 'user' | 'assistant'
  content: string
  queryId?: number | null
  sources?: Source[]
  timings?: Timings | null
  stats?: GenerationStats | null
  analysis?: QueryAnalysis | null
  error?: string | null
}

export function addMessage(db: DocMindDb, input: MessageInput): number {
  return db.orm
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      queryId: input.queryId ?? null,
      sources: JSON.stringify(input.sources ?? []),
      timings: input.timings ? JSON.stringify(input.timings) : null,
      stats: input.stats ? JSON.stringify(input.stats) : null,
      analysis: input.analysis ? JSON.stringify(input.analysis) : null,
      error: input.error ?? null,
      createdAt: nowMs()
    })
    .returning({ id: messages.id })
    .get().id
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function listMessages(db: DocMindDb, conversationId: number): ChatMessage[] {
  return db.orm
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.id)
    .all()
    .map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      sources: parseJson<Source[]>(m.sources, []),
      timings: parseJson<Timings | null>(m.timings, null),
      stats: parseJson<GenerationStats | null>(m.stats, null),
      analysis: parseJson<QueryAnalysis | null>(m.analysis, null),
      error: m.error
    }))
}

export function conversationQueryIds(db: DocMindDb, conversationId: number): number[] {
  return db.orm
    .select({ queryId: messages.queryId })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), sql`${messages.queryId} IS NOT NULL`))
    .all()
    .map((r) => r.queryId as number)
}

/* ------------------------------- settings ----------------------------- */

export function readSetting(db: DocMindDb, key: string): string | undefined {
  return db.orm.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, key)).get()
    ?.value
}

export function writeSetting(db: DocMindDb, key: string, value: string): void {
  db.orm
    .insert(settingsTable)
    .values({ key, value, updatedAt: nowMs() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: nowMs() } })
    .run()
}

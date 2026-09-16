import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch() * 1000)`

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
  lastIndexedAt: integer('last_indexed_at')
})

export const documents = sqliteTable(
  'documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    relativePath: text('relative_path').notNull(),
    filename: text('filename').notNull(),
    hash: text('hash').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    wordCount: integer('word_count').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [uniqueIndex('documents_project_path_idx').on(t.projectId, t.relativePath)]
)

export const sections = sqliteTable(
  'sections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull().default(0),
    level: integer('level').notNull().default(0),
    heading: text('heading').notNull(),
    headingPath: text('heading_path').notNull(),
    content: text('content').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    tokens: integer('tokens').notNull(),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('sections_document_idx').on(t.documentId)]
)

export const queries = sqliteTable(
  'queries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    conversationId: integer('conversation_id'),
    text: text('text').notNull(),
    intent: text('intent').notNull(),
    symbols: text('symbols').notNull().default('[]'),
    keywords: text('keywords').notNull().default('[]'),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('queries_project_idx').on(t.projectId)]
)

export const retrievalResults = sqliteTable(
  'retrieval_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    queryId: integer('query_id')
      .notNull()
      .references(() => queries.id, { onDelete: 'cascade' }),
    sectionId: integer('section_id').notNull(),
    rank: integer('rank').notNull(),
    score: real('score').notNull(),
    selected: integer('selected').notNull().default(0),
    breakdown: text('breakdown').notNull().default('{}'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('retrieval_results_query_idx').on(t.queryId)]
)

export const conversations = sqliteTable(
  'conversations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [index('conversations_project_idx').on(t.projectId)]
)

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    queryId: integer('query_id'),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    sources: text('sources').notNull().default('[]'),
    timings: text('timings'),
    stats: text('stats'),
    analysis: text('analysis'),
    error: text('error'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId)]
)

export const settingsTable = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(now)
})

export const schema = {
  projects,
  documents,
  sections,
  queries,
  retrievalResults,
  conversations,
  messages,
  settingsTable
}

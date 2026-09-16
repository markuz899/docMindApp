/**
 * Raw DDL. `schema.ts` mirrors it for typed Drizzle queries and
 * `tests/database.test.ts` asserts the two never drift apart.
 */
export const FTS_TOKENIZER = `unicode61 remove_diacritics 2 tokenchars '-_/'`

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     path TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_indexed_at INTEGER
   )`,

  `CREATE TABLE IF NOT EXISTS documents (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     relative_path TEXT NOT NULL,
     filename TEXT NOT NULL,
     hash TEXT NOT NULL,
     size_bytes INTEGER NOT NULL DEFAULT 0,
     word_count INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS documents_project_path_idx ON documents(project_id, relative_path)`,

  `CREATE TABLE IF NOT EXISTS sections (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     ordinal INTEGER NOT NULL DEFAULT 0,
     level INTEGER NOT NULL DEFAULT 0,
     heading TEXT NOT NULL,
     heading_path TEXT NOT NULL,
     content TEXT NOT NULL,
     start_line INTEGER NOT NULL,
     end_line INTEGER NOT NULL,
     tokens INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sections_document_idx ON sections(document_id)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
     filename,
     heading,
     heading_path,
     content,
     section_id UNINDEXED,
     document_id UNINDEXED,
     project_id UNINDEXED,
     tokenize = "${FTS_TOKENIZER}"
   )`,

  `CREATE TABLE IF NOT EXISTS queries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
     text TEXT NOT NULL,
     intent TEXT NOT NULL,
     symbols TEXT NOT NULL DEFAULT '[]',
     keywords TEXT NOT NULL DEFAULT '[]',
     duration_ms INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS queries_project_idx ON queries(project_id)`,

  `CREATE TABLE IF NOT EXISTS retrieval_results (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     query_id INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
     section_id INTEGER NOT NULL,
     rank INTEGER NOT NULL,
     score REAL NOT NULL,
     selected INTEGER NOT NULL DEFAULT 0,
     breakdown TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS retrieval_results_query_idx ON retrieval_results(query_id)`,

  `CREATE TABLE IF NOT EXISTS conversations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS conversations_project_idx ON conversations(project_id)`,

  `CREATE TABLE IF NOT EXISTS messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     query_id INTEGER REFERENCES queries(id) ON DELETE SET NULL,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     sources TEXT NOT NULL DEFAULT '[]',
     timings TEXT,
     stats TEXT,
     analysis TEXT,
     error TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id)`,

  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`
]

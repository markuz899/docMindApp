import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { MIGRATIONS } from './migrations'
import { schema } from './schema'

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly reason?: unknown
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

export interface DocMindDb {
  raw: Database.Database
  orm: BetterSQLite3Database<typeof schema>
  file: string
  close(): void
}

/** Opens (creating if needed) the SQLite file and brings the schema up to date. */
export function openDatabase(file: string): DocMindDb {
  try {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })

    const raw = new Database(file)
    raw.pragma('journal_mode = WAL')
    raw.pragma('foreign_keys = ON')
    raw.pragma('synchronous = NORMAL')
    raw.pragma('busy_timeout = 5000')

    raw.transaction(() => {
      for (const statement of MIGRATIONS) raw.exec(statement)
    })()

    assertFts5(raw)

    return {
      raw,
      orm: drizzle(raw, { schema }),
      file,
      close: () => raw.close()
    }
  } catch (error) {
    throw new DatabaseError(
      `Could not open the DocMind database at ${file}: ${(error as Error).message}`,
      error
    )
  }
}

function assertFts5(raw: Database.Database): void {
  const row = raw.prepare(`SELECT count(*) AS n FROM pragma_compile_options WHERE compile_options LIKE 'ENABLE_FTS5'`).get() as { n: number }
  if (row.n === 0) throw new Error('this SQLite build has no FTS5 support')
}

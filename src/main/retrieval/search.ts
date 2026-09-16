import type { DocMindDb } from '../database/client'
import type { QueryAnalysis } from '@shared/types'
import { symbolParts } from './symbols'

export interface SearchCandidate {
  sectionId: number
  documentId: number
  filename: string
  relativePath: string
  heading: string
  headingPath: string
  content: string
  startLine: number
  endLine: number
  tokens: number
  bm25: number | null
  via: 'exact' | 'fts'
}

export interface SearchOutcome {
  candidates: SearchCandidate[]
  ftsQuery: string
  totalSections: number
  totalDocuments: number
  ftsError: string | null
}

const SECTION_COLUMNS = `
  s.id            AS sectionId,
  s.document_id   AS documentId,
  d.filename      AS filename,
  d.relative_path AS relativePath,
  s.heading       AS heading,
  s.heading_path  AS headingPath,
  s.content       AS content,
  s.start_line    AS startLine,
  s.end_line      AS endLine,
  s.tokens        AS tokens`

type RawRow = Omit<SearchCandidate, 'bm25' | 'via'> & { bm25?: number }

/** Quotes a term as an FTS5 phrase; returns null when nothing is left to match. */
export function toPhrase(term: string): string | null {
  const cleaned = term.replace(/"/g, '').trim()
  if (cleaned.length === 0) return null
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null
  return `"${cleaned}"`
}

export function buildFtsQuery(analysis: Pick<QueryAnalysis, 'symbols' | 'keywords'>): string {
  const terms = new Set<string>()

  for (const symbol of analysis.symbols) {
    const phrase = toPhrase(symbol)
    if (phrase) terms.add(phrase)
    for (const part of symbolParts(symbol)) {
      const partPhrase = toPhrase(part)
      if (partPhrase) terms.add(partPhrase)
    }
  }
  for (const keyword of analysis.keywords) {
    const phrase = toPhrase(keyword)
    if (phrase) terms.add(phrase)
  }

  return [...terms].join(' OR ')
}

export function searchSections(
  db: DocMindDb,
  projectId: number,
  analysis: QueryAnalysis,
  limit: number
): SearchOutcome {
  const totals = db.raw
    .prepare(
      `SELECT (SELECT count(*) FROM documents WHERE project_id = ?) AS totalDocuments,
              (SELECT count(*) FROM sections s JOIN documents d ON d.id = s.document_id WHERE d.project_id = ?) AS totalSections`
    )
    .get(projectId, projectId) as { totalDocuments: number; totalSections: number }

  const merged = new Map<number, SearchCandidate>()

  // 1. Exact symbol matches get their own pass so they can never be crowded
  //    out of the candidate window by prose-only FTS hits.
  const exactStatement = db.raw.prepare(
    `SELECT ${SECTION_COLUMNS}
     FROM sections s JOIN documents d ON d.id = s.document_id
     WHERE d.project_id = ?
       AND (instr(lower(s.heading), ?) > 0
         OR instr(lower(s.heading_path), ?) > 0
         OR instr(lower(d.filename), ?) > 0
         OR instr(lower(s.content), ?) > 0)
     LIMIT ?`
  )

  for (const symbol of analysis.symbols) {
    const needle = symbol.toLowerCase()
    const rows = exactStatement.all(projectId, needle, needle, needle, needle, limit) as RawRow[]
    for (const row of rows) {
      if (!merged.has(row.sectionId)) merged.set(row.sectionId, { ...row, bm25: null, via: 'exact' })
    }
  }

  // 2. FTS5/BM25 pass.
  const ftsQuery = buildFtsQuery(analysis)
  let ftsError: string | null = null

  if (ftsQuery !== '') {
    try {
      const rows = db.raw
        .prepare(
          `SELECT ${SECTION_COLUMNS},
                  bm25(sections_fts, 6.0, 12.0, 6.0, 1.0, 0.0, 0.0, 0.0) AS bm25
           FROM sections_fts f
           JOIN sections s ON s.id = f.section_id
           JOIN documents d ON d.id = s.document_id
           WHERE sections_fts MATCH ? AND f.project_id = ?
           ORDER BY bm25
           LIMIT ?`
        )
        .all(ftsQuery, projectId, limit) as Required<RawRow>[]

      for (const row of rows) {
        const existing = merged.get(row.sectionId)
        if (existing) existing.bm25 = row.bm25
        else merged.set(row.sectionId, { ...row, bm25: row.bm25, via: 'fts' })
      }
    } catch (error) {
      ftsError = (error as Error).message
    }
  }

  return {
    candidates: [...merged.values()],
    ftsQuery,
    totalSections: totals.totalSections,
    totalDocuments: totals.totalDocuments,
    ftsError
  }
}

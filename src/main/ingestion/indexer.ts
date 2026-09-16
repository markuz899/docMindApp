import { eq } from 'drizzle-orm'
import type { DocMindDb } from '../database/client'
import { documents } from '../database/schema'
import {
  deleteDocuments,
  documentsByPath,
  markIndexed,
  replaceSections,
  type SectionInput
} from '../database/repositories'
import { hashContent, readTextFile, walkDocuments } from '../filesystem/scanner'
import { countWords, parseDocument } from './markdown'
import type { GeneralSettings, IndexProgress, IndexReport } from '@shared/types'

export interface IndexOptions {
  projectId: number
  root: string
  settings: GeneralSettings
  onProgress?: (progress: IndexProgress) => void
  signal?: AbortSignal
}

/**
 * Incremental reindex: a file whose content hash is unchanged is never
 * re-parsed and never touches the FTS index.
 */
export async function indexProject(db: DocMindDb, options: IndexOptions): Promise<IndexReport> {
  const startedAt = Date.now()
  const { projectId, root, settings, onProgress } = options

  const scan = await walkDocuments(root, {
    extensions: settings.extensions,
    ignoredDirectories: settings.ignoredDirectories,
    maxFileSizeKb: settings.maxFileSizeKb,
    onProgress: (scanned) => onProgress?.({ phase: 'scanning', scanned })
  })

  const known = documentsByPath(db, projectId)
  const seen = new Set<string>()
  const report: IndexReport = {
    projectId,
    added: 0,
    changed: 0,
    deleted: 0,
    unchanged: 0,
    sections: 0,
    words: 0,
    durationMs: 0,
    errors: scan.skipped.map((s) => ({ relativePath: s.relativePath, message: s.reason }))
  }

  let done = 0
  for (const file of scan.files) {
    if (options.signal?.aborted) break
    done += 1
    onProgress?.({ phase: 'parsing', file: file.relativePath, done, total: scan.files.length })
    seen.add(file.relativePath)

    try {
      const content = await readTextFile(file.absolutePath)
      const hash = hashContent(content)
      const existing = known.get(file.relativePath)

      if (existing && existing.hash === hash) {
        report.unchanged += 1
        report.words += existing.wordCount
        continue
      }

      const parsed = parseDocument(file.relativePath, content)
      const words = countWords(content)
      const sectionInputs: SectionInput[] = parsed.map((section) => ({
        ordinal: section.ordinal,
        level: section.level,
        heading: section.heading,
        headingPath: section.headingPath,
        content: section.content,
        startLine: section.startLine,
        endLine: section.endLine,
        tokens: section.tokens
      }))

      const ts = Date.now()
      let documentId: number
      if (existing) {
        db.orm
          .update(documents)
          .set({ hash, sizeBytes: file.sizeBytes, wordCount: words, updatedAt: ts })
          .where(eq(documents.id, existing.id))
          .run()
        documentId = existing.id
        report.changed += 1
      } else {
        documentId = db.orm
          .insert(documents)
          .values({
            projectId,
            relativePath: file.relativePath,
            filename: file.filename,
            hash,
            sizeBytes: file.sizeBytes,
            wordCount: words,
            createdAt: ts,
            updatedAt: ts
          })
          .returning({ id: documents.id })
          .get().id
        report.added += 1
      }

      replaceSections(db, projectId, documentId, file.filename, sectionInputs)
      report.sections += sectionInputs.length
      report.words += words
    } catch (error) {
      report.errors.push({ relativePath: file.relativePath, message: (error as Error).message })
    }
  }

  const removable = [...known.entries()].filter(([relativePath]) => !seen.has(relativePath))
  if (removable.length > 0 && !options.signal?.aborted) {
    deleteDocuments(db, removable.map(([, doc]) => doc.id))
    report.deleted = removable.length
  }

  markIndexed(db, projectId)
  report.durationMs = Date.now() - startedAt
  onProgress?.({ phase: 'done', report })
  return report
}

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import path from 'node:path'

export interface FileRef {
  absolutePath: string
  relativePath: string
  filename: string
  sizeBytes: number
}

export interface ScanOptions {
  extensions: string[]
  ignoredDirectories: string[]
  maxFileSizeKb: number
  onProgress?: (scanned: number) => void
}

export interface ScanResult {
  files: FileRef[]
  skipped: { relativePath: string; reason: string }[]
}

export class FilesystemError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'not_a_directory' | 'unreadable'
  ) {
    super(message)
    this.name = 'FilesystemError'
  }
}

export async function assertReadableDirectory(root: string): Promise<void> {
  let stat: Stats
  try {
    stat = await fs.stat(root)
  } catch {
    throw new FilesystemError(`The folder ${root} does not exist.`, 'not_found')
  }
  if (!stat.isDirectory()) throw new FilesystemError(`${root} is not a folder.`, 'not_a_directory')
  try {
    await fs.readdir(root)
  } catch {
    throw new FilesystemError(`The folder ${root} cannot be read (permissions?).`, 'unreadable')
  }
}

/** Recursive walk that never follows symlinked directories. */
export async function walkDocuments(root: string, options: ScanOptions): Promise<ScanResult> {
  await assertReadableDirectory(root)

  const ignored = new Set(options.ignoredDirectories.map((d) => d.toLowerCase()))
  const extensions = new Set(options.extensions.map((e) => e.toLowerCase()))
  const maxBytes = options.maxFileSizeKb * 1024
  const files: FileRef[] = []
  const skipped: ScanResult['skipped'] = []
  let scanned = 0

  const visit = async (dir: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      skipped.push({ relativePath: path.relative(root, dir) || '.', reason: (error as Error).message })
      return
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = path.relative(root, absolutePath)

      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (ignored.has(entry.name.toLowerCase())) continue
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      if (!extensions.has(path.extname(entry.name).toLowerCase())) continue

      scanned += 1
      options.onProgress?.(scanned)

      try {
        const stat = await fs.stat(absolutePath)
        if (stat.size > maxBytes) {
          skipped.push({ relativePath, reason: `larger than ${options.maxFileSizeKb} KB` })
          continue
        }
        files.push({ absolutePath, relativePath, filename: entry.name, sizeBytes: stat.size })
      } catch (error) {
        skipped.push({ relativePath, reason: (error as Error).message })
      }
    }
  }

  await visit(root)
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return { files, skipped }
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

export async function readTextFile(absolutePath: string): Promise<string> {
  const buffer = await fs.readFile(absolutePath)
  // Strip a UTF-8 BOM so hashes stay stable across editors.
  return buffer.toString('utf8').replace(/^\uFEFF/, '')
}

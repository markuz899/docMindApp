import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { upsertProject, countSections, documentsByPath, listDocuments } from '@main/database/repositories'
import { hashContent, walkDocuments } from '@main/filesystem/scanner'
import { indexProject } from '@main/ingestion/indexer'
import { DEFAULT_SETTINGS } from '@shared/types'
import { memoryDb } from './helpers'

const general = DEFAULT_SETTINGS.general
const temporaries: string[] = []

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docmind-test-'))
  temporaries.push(dir)
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  return dir
}

describe('scanner', () => {
  it('walks recursively and skips ignored directories', async () => {
    const root = await fixture({
      'a.md': '# A',
      'docs/b.mdx': '# B',
      'notes.txt': 'plain',
      'ignored.png': 'binary',
      'node_modules/pkg/readme.md': '# nope',
      '.git/config': 'nope'
    })
    const { files } = await walkDocuments(root, general)
    expect(files.map((f) => f.relativePath).sort()).toEqual(['a.md', 'docs/b.mdx', 'notes.txt'])
  })

  it('reports a missing folder instead of throwing a raw errno', async () => {
    await expect(walkDocuments('/definitely/not/here', general)).rejects.toThrow(/does not exist/)
  })

  it('skips files above the size limit', async () => {
    const root = await fixture({ 'big.md': 'x'.repeat(5000) })
    const { files, skipped } = await walkDocuments(root, { ...general, maxFileSizeKb: 1 })
    expect(files).toHaveLength(0)
    expect(skipped[0]?.reason).toMatch(/larger than/)
  })

  it('hashes content, not file metadata', () => {
    expect(hashContent('same')).toBe(hashContent('same'))
    expect(hashContent('same')).not.toBe(hashContent('other'))
  })
})

describe('incremental reindex', () => {
  it('classifies files as added, changed, deleted or unchanged', async () => {
    const db = memoryDb()
    const root = await fixture({ 'a.md': '# A\n\nalpha', 'b.md': '# B\n\nbeta' })
    const project = upsertProject(db, root, 'demo')

    const first = await indexProject(db, { projectId: project.id, root, settings: general })
    expect(first).toMatchObject({ added: 2, changed: 0, deleted: 0, unchanged: 0 })

    const second = await indexProject(db, { projectId: project.id, root, settings: general })
    expect(second).toMatchObject({ added: 0, changed: 0, deleted: 0, unchanged: 2 })

    await fs.writeFile(path.join(root, 'a.md'), '# A\n\nalpha changed')
    await fs.writeFile(path.join(root, 'c.md'), '# C\n\ngamma')
    await fs.rm(path.join(root, 'b.md'))

    const third = await indexProject(db, { projectId: project.id, root, settings: general })
    expect(third).toMatchObject({ added: 1, changed: 1, deleted: 1, unchanged: 0 })
    expect(listDocuments(db, project.id).map((d) => d.relativePath)).toEqual(['a.md', 'c.md'])
    db.close()
  })

  it('does not reparse a file whose hash is unchanged', async () => {
    const db = memoryDb()
    const root = await fixture({ 'a.md': '# A\n\nalpha' })
    const project = upsertProject(db, root, 'demo')
    await indexProject(db, { projectId: project.id, root, settings: general })

    const sectionId = db.raw.prepare(`SELECT id FROM sections LIMIT 1`).get() as { id: number }
    await indexProject(db, { projectId: project.id, root, settings: general })
    const after = db.raw.prepare(`SELECT id FROM sections LIMIT 1`).get() as { id: number }

    // Reparsing would delete and reinsert the row, changing its id.
    expect(after.id).toBe(sectionId.id)
    db.close()
  })

  it('keeps the FTS index in sync when a document is deleted', async () => {
    const db = memoryDb()
    const root = await fixture({ 'a.md': '# Alpha\n\nunique-token-xyz' })
    const project = upsertProject(db, root, 'demo')
    await indexProject(db, { projectId: project.id, root, settings: general })

    const before = db.raw
      .prepare(`SELECT count(*) AS n FROM sections_fts WHERE sections_fts MATCH ?`)
      .get('"unique-token-xyz"') as { n: number }
    expect(before.n).toBe(1)

    await fs.rm(path.join(root, 'a.md'))
    await indexProject(db, { projectId: project.id, root, settings: general })

    const after = db.raw
      .prepare(`SELECT count(*) AS n FROM sections_fts WHERE sections_fts MATCH ?`)
      .get('"unique-token-xyz"') as { n: number }
    expect(after.n).toBe(0)
    expect(countSections(db, project.id)).toBe(0)
    db.close()
  })

  it('records an unreadable file as an error instead of aborting the run', async () => {
    const db = memoryDb()
    const root = await fixture({ 'ok.md': '# Ok\n\nbody', 'broken.md': 'x' })
    await fs.chmod(path.join(root, 'broken.md'), 0o000)
    const project = upsertProject(db, root, 'demo')

    const report = await indexProject(db, { projectId: project.id, root, settings: general })
    await fs.chmod(path.join(root, 'broken.md'), 0o644)

    expect(report.added).toBe(1)
    expect(report.errors.some((e) => e.relativePath === 'broken.md')).toBe(true)
    expect(documentsByPath(db, project.id).has('ok.md')).toBe(true)
    db.close()
  })

  it('reports an empty folder as zero documents rather than failing', async () => {
    const db = memoryDb()
    const root = await fixture({ 'readme.png': 'binary' })
    const project = upsertProject(db, root, 'demo')
    const report = await indexProject(db, { projectId: project.id, root, settings: general })
    expect(report).toMatchObject({ added: 0, unchanged: 0, sections: 0 })
    db.close()
  })
})

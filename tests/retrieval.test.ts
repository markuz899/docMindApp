import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DocMindDb } from '@main/database/client'
import { analyzeQuery } from '@main/retrieval/analyzer'
import { buildContext } from '@main/retrieval/context'
import { rankCandidates, selectSections } from '@main/retrieval/ranking'
import { buildFtsQuery, searchSections, toPhrase } from '@main/retrieval/search'
import { DEFAULT_SETTINGS, type RetrievedSection } from '@shared/types'
import { indexedDemo } from './helpers'

const retrieval = DEFAULT_SETTINGS.retrieval
let db: DocMindDb
let projectId: number

beforeAll(async () => {
  const demo = await indexedDemo()
  db = demo.db
  projectId = demo.projectId
})

afterAll(() => db.close())

function retrieve(question: string): RetrievedSection[] {
  const analysis = analyzeQuery(question)
  const outcome = searchSections(db, projectId, analysis, retrieval.candidateLimit)
  return selectSections(rankCandidates(outcome.candidates, analysis, retrieval), retrieval)
}

describe('fts query building', () => {
  it('quotes terms as phrases and drops empty ones', () => {
    expect(toPhrase('/me')).toBe('"/me"')
    expect(toPhrase('  ')).toBeNull()
    expect(toPhrase('---')).toBeNull()
  })

  it('expands a symbol into the symbol itself plus its parts', () => {
    expect(buildFtsQuery({ symbols: ['/api/users'], keywords: [] })).toBe('"/api/users" OR "api" OR "users"')
  })
})

describe('FTS5 search', () => {
  it('indexes the whole demo project', () => {
    const totals = db.raw
      .prepare(`SELECT count(*) AS n FROM sections_fts WHERE project_id = ?`)
      .get(projectId) as { n: number }
    expect(totals.n).toBeGreaterThan(30)
  })

  it('keeps technical tokens intact through the tokenizer', () => {
    const rows = db.raw
      .prepare(`SELECT heading FROM sections_fts WHERE sections_fts MATCH ? AND project_id = ?`)
      .all('"/me"', projectId) as { heading: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.heading === 'GET /me')).toBe(true)
  })

  it.each(['"DATABASE_URL"', '"UserService"', '"getCurrentUser"', '"HTTP 500"', '"/api/v1"'])(
    'matches the technical token %s',
    (match) => {
      const rows = db.raw
        .prepare(`SELECT count(*) AS n FROM sections_fts WHERE sections_fts MATCH ? AND project_id = ?`)
        .get(match, projectId) as { n: number }
      expect(rows.n).toBeGreaterThan(0)
    }
  )

  it('returns a BM25 score for full text hits', () => {
    const analysis = analyzeQuery('How does JWT authentication work?')
    const outcome = searchSections(db, projectId, analysis, 50)
    expect(outcome.ftsError).toBeNull()
    expect(outcome.candidates.some((c) => c.bm25 !== null)).toBe(true)
  })

  it('finds exact symbol matches even when FTS would rank them low', () => {
    const analysis = analyzeQuery('USER_ID_HEADER')
    const outcome = searchSections(db, projectId, analysis, 50)
    expect(outcome.candidates.some((c) => c.content.includes('USER_ID_HEADER'))).toBe(true)
  })
})

describe('ranking', () => {
  it('puts an exact symbol match in the heading first', () => {
    const ranked = retrieve('Where is GET /me documented?')
    expect(ranked[0]?.heading).toBe('GET /me')
    expect(ranked[0]?.relativePath).toBe('04-api-reference.md')
    expect(ranked[0]?.matchedSymbols).toContain('/me')
  })

  it('scores every component of the breakdown', () => {
    const top = retrieve('Where is GET /me documented?')[0]
    expect(top?.breakdown.exactSymbol).toBeGreaterThan(0)
    expect(top?.score).toBeGreaterThan(0)
    expect(top?.score).toBeLessThanOrEqual(1)
  })

  it('selects between minSections and maxSections', () => {
    const ranked = retrieve('How does authentication work?')
    const selected = ranked.filter((s) => s.selected)
    expect(selected.length).toBeGreaterThanOrEqual(Math.min(retrieval.minSections, ranked.length))
    expect(selected.length).toBeLessThanOrEqual(retrieval.maxSections)
  })

  it('honours a lowered maxSections from settings', () => {
    const analysis = analyzeQuery('How does authentication work?')
    const outcome = searchSections(db, projectId, analysis, retrieval.candidateLimit)
    const tight = { ...retrieval, maxSections: 2, minSections: 1 }
    const ranked = selectSections(rankCandidates(outcome.candidates, analysis, tight), tight)
    expect(ranked.filter((s) => s.selected)).toHaveLength(2)
  })

  it('ranks the right sections for the Italian bug report', () => {
    const ranked = retrieve('Mi hanno aperto un bug: la rotta /me riporta informazioni sbagliate')
    const selected = ranked.filter((s) => s.selected)
    const text = selected.map((s) => `${s.relativePath} ${s.headingPath} ${s.content}`).join('\n')

    expect(selected.length).toBeGreaterThanOrEqual(3)
    expect(selected.some((s) => s.heading === 'GET /me' && s.relativePath === '04-api-reference.md')).toBe(true)
    expect(text).toContain('UserController')
    expect(text).toContain('UserService')

    // The failure-mode sections must beat the unrelated /me routes.
    expect(selected.slice(0, 3).map((s) => s.headingPath).join(' ')).toContain('wrong')
    expect(new Set(selected.map((s) => s.relativePath)).size).toBeGreaterThanOrEqual(3)
    expect(ranked.map((s) => s.relativePath)).toContain('05-main-flows.md')
  })

  it('lets the detected intent surface the flow section for a bug report', () => {
    const asBug = retrieve('Mi hanno aperto un bug: la rotta /me riporta informazioni sbagliate')
    const flow = asBug.find((s) => s.heading === 'Current user flow')
    expect(flow?.breakdown.intent).toBeGreaterThan(0)
  })

  it('caps how many sections a single document can contribute', () => {
    const ranked = retrieve('Mi hanno aperto un bug: la rotta /me riporta informazioni sbagliate')
    const perDocument = new Map<string, number>()
    for (const section of ranked.filter((s) => s.selected)) {
      perDocument.set(section.relativePath, (perDocument.get(section.relativePath) ?? 0) + 1)
    }
    expect(Math.max(...perDocument.values())).toBeLessThanOrEqual(3)
  })

  it('returns nothing for a question the documentation cannot answer', () => {
    const ranked = retrieve('How do I configure Kubernetes autoscaling for the payment mesh?')
    expect(ranked.filter((s) => s.selected && s.breakdown.exactSymbol > 0)).toHaveLength(0)
  })
})

describe('context builder', () => {
  it('builds the documented prompt layout', () => {
    const ranked = retrieve('Where is GET /me documented?')
    const context = buildContext('Where is GET /me documented?', ranked, retrieval)

    expect(context.prompt).toContain('QUESTION')
    expect(context.prompt).toContain('DOCUMENTATION')
    expect(context.prompt).toContain('INSTRUCTIONS')
    expect(context.prompt).toContain('[SOURCE 1]')
    expect(context.prompt).toContain('File: 04-api-reference.md')
    expect(context.prompt).toContain('Heading: API reference > GET /me')
    expect(context.prompt).toContain('Answer the question using only the supplied documentation.')
    expect(context.prompt).toContain('Separate facts from hypotheses.')
  })

  it('emits one source per selected section', () => {
    const ranked = retrieve('Where is GET /me documented?')
    const context = buildContext('q', ranked, retrieval)
    expect(context.sources).toHaveLength(context.used.length)
    expect(context.sources[0]?.excerpt.length).toBeLessThanOrEqual(241)
    expect(context.sources[0]?.relevance).toBeGreaterThan(0)
  })

  it('never exceeds the configured character budget', () => {
    const ranked = retrieve('How does authentication work?')
    const context = buildContext('How does authentication work?', ranked, { ...retrieval, maxContextChars: 1500 })
    expect(context.characters).toBeLessThanOrEqual(1500 + 600)
    expect(context.truncated).toBe(true)
  })

  it('says so explicitly when nothing was selected', () => {
    const context = buildContext('anything', [], retrieval)
    expect(context.prompt).toContain('no matching documentation was found')
    expect(context.sources).toHaveLength(0)
  })
})

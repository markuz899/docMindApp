import type { Intent, QueryAnalysis, RetrievedSection, RetrievalSettings, ScoreBreakdown } from '@shared/types'
import type { SearchCandidate } from './search'

const HEADING_WEIGHT = 1
const HEADING_PATH_WEIGHT = 0.8
const FILENAME_WEIGHT = 0.7
const CONTENT_WEIGHT = 0.45

/** A heading that *is* the symbol beats one that merely mentions it. */
const COVERAGE_FLOOR = 0.55

/** Fraction of the best score below which a candidate is considered noise. */
const RELATIVE_FLOOR = 0.2

/**
 * ponytail: fixed cap instead of another setting — it stops one chatty file
 * from filling the whole context. Promote to Settings if a project ever needs
 * a different value.
 */
const MAX_SECTIONS_PER_DOCUMENT = 3

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** 1 when the symbol is the whole text, approaching COVERAGE_FLOOR when it is a fragment. */
function coverage(text: string, symbol: string): number {
  return COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * Math.min(1, symbol.length / Math.max(text.length, 1))
}

interface SymbolMatch {
  anywhere: number
  heading: number
  filename: number
  matched: string[]
}

function symbolScore(candidate: SearchCandidate, symbols: string[]): SymbolMatch {
  if (symbols.length === 0) return { anywhere: 0, heading: 0, filename: 0, matched: [] }

  const matched: string[] = []
  let anywhere = 0
  let heading = 0
  let filename = 0

  for (const symbol of symbols) {
    let best = 0
    let headingHit = 0

    if (includesCI(candidate.heading, symbol)) {
      headingHit = HEADING_WEIGHT * coverage(candidate.heading, symbol)
      best = headingHit
    } else if (includesCI(candidate.headingPath, symbol)) {
      headingHit = HEADING_PATH_WEIGHT * coverage(candidate.headingPath, symbol)
      best = headingHit
    } else if (includesCI(candidate.filename, symbol)) {
      best = FILENAME_WEIGHT
      filename += 1
    } else if (includesCI(candidate.content, symbol)) {
      best = CONTENT_WEIGHT
    }

    if (includesCI(candidate.filename, symbol) && best !== FILENAME_WEIGHT) filename += 1
    if (best > 0) matched.push(symbol)
    anywhere += best
    heading += headingHit
  }

  return {
    anywhere: anywhere / symbols.length,
    heading: heading / symbols.length,
    filename: filename / symbols.length,
    matched
  }
}

/**
 * Vocabulary that makes the detected intent load-bearing: a bug report should
 * surface the troubleshooting section, not only the reference page.
 */
const INTENT_LEXICON: Record<Intent, string[]> = {
  question: [],
  bug_investigation: [
    'bug', 'wrong', 'incorrect', 'broken', 'unexpected', 'stale', 'issue', 'fails', 'failure',
    'regression', 'troubleshooting', 'known failure', 'misread'
  ],
  error: ['error', 'exception', 'failure', 'fails', 'crash', 'trace', 'status code', 'http 4', 'http 5'],
  architecture: ['architecture', 'layer', 'component', 'module', 'structure', 'responsib', 'overview', 'depend'],
  how_it_works: ['flow', 'step', 'process', 'verif', 'handled by', 'returns'],
  dependency: ['depend', 'calls', 'client', 'provider', 'uses', 'external', 'import', 'only component'],
  data_flow: ['flow', 'step', 'request', 'response', 'pipeline', 'sequence', 'merge', 'reads']
}

const INTENT_SATURATION = 3

/** ponytail: constant, not a setting — one more slider here helps nobody. */
const INTENT_WEIGHT = 0.9

function intentScore(candidate: SearchCandidate, intent: Intent): number {
  const terms = INTENT_LEXICON[intent]
  if (terms.length === 0) return 0
  const haystack = `${candidate.heading} ${candidate.headingPath} ${candidate.content}`.toLowerCase()
  const hits = terms.filter((term) => haystack.includes(term)).length
  return Math.min(1, hits / INTENT_SATURATION)
}

function overlap(haystack: string, keywords: string[]): number {
  if (keywords.length === 0) return 0
  const lower = haystack.toLowerCase()
  return keywords.filter((keyword) => lower.includes(keyword)).length / keywords.length
}

/** BM25 is negative and unbounded; fold it into 0..1 relative to the best hit. */
function normalizeBm25(candidates: SearchCandidate[]): Map<number, number> {
  const scores = new Map<number, number>()
  const values = candidates.map((c) => (c.bm25 === null ? 0 : -c.bm25)).filter((v) => v > 0)
  const max = values.length > 0 ? Math.max(...values) : 0

  for (const candidate of candidates) {
    const value = candidate.bm25 === null ? 0 : -candidate.bm25
    scores.set(candidate.sectionId, max > 0 ? Math.max(0, Math.min(1, value / max)) : 0)
  }
  return scores
}

export function rankCandidates(
  candidates: SearchCandidate[],
  analysis: QueryAnalysis,
  settings: RetrievalSettings
): RetrievedSection[] {
  const ftsScores = normalizeBm25(candidates)
  const maxScore =
    settings.exactMatchBoost +
    settings.headingBoost +
    settings.filenameBoost +
    settings.ftsWeight +
    settings.keywordWeight +
    INTENT_WEIGHT

  return candidates
    .map((candidate) => {
      const symbols = symbolScore(candidate, analysis.symbols)

      // Heading and filename each blend the symbol signal with plain keyword
      // overlap, so both stay meaningful for questions without symbols.
      const breakdown: ScoreBreakdown = {
        exactSymbol: symbols.anywhere,
        heading: Math.max(symbols.heading, overlap(`${candidate.heading} ${candidate.headingPath}`, analysis.keywords)),
        filename: Math.max(symbols.filename, overlap(candidate.filename, analysis.keywords)),
        fts: ftsScores.get(candidate.sectionId) ?? 0,
        keyword: overlap(candidate.content, analysis.keywords),
        intent: intentScore(candidate, analysis.intent)
      }

      const raw =
        breakdown.exactSymbol * settings.exactMatchBoost +
        breakdown.heading * settings.headingBoost +
        breakdown.filename * settings.filenameBoost +
        breakdown.fts * settings.ftsWeight +
        breakdown.keyword * settings.keywordWeight +
        breakdown.intent * INTENT_WEIGHT

      return {
        sectionId: candidate.sectionId,
        documentId: candidate.documentId,
        filename: candidate.filename,
        relativePath: candidate.relativePath,
        heading: candidate.heading,
        headingPath: candidate.headingPath,
        content: candidate.content,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        tokens: candidate.tokens,
        score: maxScore > 0 ? Math.min(1, raw / maxScore) : 0,
        breakdown,
        matchedSymbols: symbols.matched,
        selected: false
      } satisfies RetrievedSection
    })
    .filter((section) => section.score > 0)
    .sort((a, b) => b.score - a.score || a.sectionId - b.sectionId)
}

/**
 * Marks the sections that will actually be handed to the model, capping how
 * many can come from the same document so the context covers more ground.
 */
export function selectSections(ranked: RetrievedSection[], settings: RetrievalSettings): RetrievedSection[] {
  if (ranked.length === 0) return ranked

  const floor = (ranked[0]?.score ?? 0) * RELATIVE_FLOOR
  const minimum = Math.min(settings.minSections, ranked.length)
  const perDocument = new Map<number, number>()
  let count = 0

  const pass = (respectCap: boolean): void => {
    for (const section of ranked) {
      if (section.selected || count >= settings.maxSections) continue
      if (section.score < floor && count >= minimum) continue
      const used = perDocument.get(section.documentId) ?? 0
      if (respectCap && used >= MAX_SECTIONS_PER_DOCUMENT) continue
      section.selected = true
      perDocument.set(section.documentId, used + 1)
      count += 1
    }
  }

  pass(true)
  // Only fall back to a single document if there is nothing else to pick.
  if (count < minimum) pass(false)

  return ranked
}

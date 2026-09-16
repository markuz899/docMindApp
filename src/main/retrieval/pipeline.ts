import { randomUUID } from 'node:crypto'
import type { DocMindDb } from '../database/client'
import { addMessage, countSections, recordQuery, recordRetrieval, touchConversation } from '../database/repositories'
import type { ModelManager } from '../llm/manager'
import { analyzeQuery } from './analyzer'
import { buildContext } from './context'
import { rankCandidates, selectSections } from './ranking'
import { searchSections, type SearchCandidate } from './search'
import type { AskResult, GenerationStats, PipelineEvent, Settings, Source, Timings } from '@shared/types'

export interface AskOptions {
  db: DocMindDb
  projectId: number
  conversationId: number
  question: string
  settings: Settings
  models: ModelManager
  emit: (event: PipelineEvent) => void
  signal?: AbortSignal
}

const MAX_MATCH_EVENTS = 40
const MAX_RANKED_EVENTS = 24

/** Real retrieval-stage signal, available before the full ranking runs. */
function provisionalScore(candidate: SearchCandidate, symbols: string[], bestBm25: number): number {
  if (candidate.bm25 !== null && bestBm25 > 0) {
    return Math.max(0, Math.min(1, -candidate.bm25 / bestBm25))
  }
  if (symbols.length === 0) return 0
  const haystack = `${candidate.heading} ${candidate.headingPath} ${candidate.filename} ${candidate.content}`.toLowerCase()
  return symbols.filter((s) => haystack.includes(s.toLowerCase())).length / symbols.length
}

export async function runAsk(options: AskOptions): Promise<AskResult> {
  const { db, projectId, conversationId, question, settings, models, emit } = options
  const runId = randomUUID()
  const startedAt = Date.now()

  const timings: Timings = {
    analysisMs: 0,
    searchMs: 0,
    rankingMs: 0,
    contextMs: 0,
    generationMs: 0,
    totalMs: 0
  }

  emit({ type: 'query_received', runId, query: question, conversationId })

  /* ----------------------------- analysis ----------------------------- */
  const analysisStart = Date.now()
  const analysis = analyzeQuery(question)
  timings.analysisMs = Date.now() - analysisStart
  emit({
    type: 'query_analyzed',
    runId,
    analysis: {
      originalQuery: analysis.originalQuery,
      symbols: analysis.symbols,
      keywords: analysis.keywords,
      intent: analysis.intent
    },
    durationMs: timings.analysisMs
  })

  const queryId = recordQuery(db, projectId, conversationId, analysis, timings.analysisMs)
  const userMessageId = addMessage(db, {
    conversationId,
    role: 'user',
    content: question,
    queryId,
    analysis
  })

  /* ------------------------------ search ------------------------------ */
  const totalSections = countSections(db, projectId)
  const searchStart = Date.now()
  const outcome = searchSections(db, projectId, analysis, settings.retrieval.candidateLimit)
  timings.searchMs = Date.now() - searchStart

  emit({
    type: 'search_started',
    runId,
    sections: totalSections,
    documents: outcome.totalDocuments,
    ftsQuery: outcome.ftsQuery
  })

  const bestBm25 = Math.max(0, ...outcome.candidates.map((c) => (c.bm25 === null ? 0 : -c.bm25)))
  const preview = outcome.candidates
    .map((candidate) => ({ candidate, score: provisionalScore(candidate, analysis.symbols, bestBm25) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCH_EVENTS)

  for (const { candidate, score } of preview) {
    emit({
      type: 'search_match',
      runId,
      sectionId: candidate.sectionId,
      documentId: candidate.documentId,
      document: candidate.relativePath,
      heading: candidate.heading,
      score,
      via: candidate.via
    })
  }
  emit({ type: 'search_completed', runId, candidates: outcome.candidates.length, durationMs: timings.searchMs })

  if (outcome.ftsError) {
    emit({ type: 'error', runId, stage: 'search', message: `full-text search fell back: ${outcome.ftsError}` })
  }

  /* ------------------------------ ranking ----------------------------- */
  emit({ type: 'ranking_started', runId, candidates: outcome.candidates.length })
  const rankingStart = Date.now()
  const ranked = selectSections(rankCandidates(outcome.candidates, analysis, settings.retrieval), settings.retrieval)
  timings.rankingMs = Date.now() - rankingStart
  emit({
    type: 'ranking_completed',
    runId,
    ranked: ranked.slice(0, MAX_RANKED_EVENTS),
    durationMs: timings.rankingMs
  })

  /* --------------------------- context build -------------------------- */
  const contextStart = Date.now()
  const context = buildContext(question, ranked, settings.retrieval)
  timings.contextMs = Date.now() - contextStart
  recordRetrieval(db, queryId, ranked)

  emit({
    type: 'context_selected',
    runId,
    sections: context.used.length,
    characters: context.characters,
    estimatedTokens: context.estimatedTokens,
    sources: context.sources
  })

  const finish = (answer: string, stats: GenerationStats | null, error: string | null): AskResult => {
    timings.totalMs = Date.now() - startedAt
    const assistantMessageId = addMessage(db, {
      conversationId,
      role: 'assistant',
      content: answer,
      queryId,
      sources: context.sources,
      timings,
      stats,
      analysis,
      error
    })
    touchConversation(db, conversationId)
    return {
      runId,
      conversationId,
      userMessageId,
      assistantMessageId,
      answer,
      sources: context.sources,
      timings,
      stats,
      analysis
    }
  }

  if (totalSections === 0) {
    const message = 'This project has no indexed sections yet. Import or reindex the documentation folder first.'
    emit({ type: 'error', runId, stage: 'search', message })
    return finish(message, null, message)
  }

  if (context.used.length === 0) {
    const message =
      'The documentation does not contain anything matching this question. Try naming a file, a heading, a route or a class.'
    emit({ type: 'error', runId, stage: 'context', message })
    return finish(message, null, message)
  }

  /* ---------------------------- generation ---------------------------- */
  const description = models.status()
  emit({ type: 'generation_started', runId, provider: description.provider, model: description.model })

  const generationStart = Date.now()
  let answer = ''
  let stats: GenerationStats | null = null
  let failure: string | null = null

  try {
    for await (const event of models.generate({
      systemPrompt: context.systemPrompt,
      prompt: context.prompt,
      temperature: settings.model.temperature,
      maxTokens: settings.model.maxTokens,
      signal: options.signal
    })) {
      if (event.type === 'token') {
        answer += event.token
        emit({ type: 'generation_token', runId, token: event.token })
      } else if (event.type === 'done') {
        stats = event.stats
      } else if (event.type === 'error') {
        failure = event.message
      }
      if (options.signal?.aborted) break
    }
  } catch (error) {
    failure = (error as Error).message
  }

  timings.generationMs = Date.now() - generationStart

  if (options.signal?.aborted) {
    emit({ type: 'cancelled', runId, stage: 'generation' })
    return finish(answer || 'Generation cancelled.', stats, 'cancelled')
  }

  if (failure && answer.trim() === '') {
    const message = `No answer was generated: ${failure}`
    emit({ type: 'error', runId, stage: 'generation', message })
    return finish(retrievalOnlyAnswer(context.sources, failure), null, failure)
  }

  const result = finish(answer, stats, failure)
  emit({
    type: 'generation_completed',
    runId,
    stats:
      stats ??
      {
        promptTokens: context.estimatedTokens,
        generatedTokens: 0,
        tokensPerSecond: 0,
        generationMs: timings.generationMs,
        provider: description.provider,
        model: description.model
      },
    timings: result.timings
  })
  return result
}

/** Retrieval still succeeded, so show what was found instead of only an error. */
function retrievalOnlyAnswer(sources: Source[], reason: string): string {
  const list = sources
    .map((source, index) => `${index + 1}. **${source.headingPath}** — \`${source.relativePath}\` (lines ${source.startLine}-${source.endLine})`)
    .join('\n')
  return [
    `**No local model produced an answer.** ${reason}`,
    '',
    'Retrieval worked though — these are the sections that match your question:',
    '',
    list
  ].join('\n')
}

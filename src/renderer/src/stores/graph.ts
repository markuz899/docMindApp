import { create } from 'zustand'
import type { GenerationStats, PipelineEvent, QueryAnalysis, Source, Timings } from '@shared/types'

export type GraphStage =
  | 'idle'
  | 'analyzing'
  | 'searching'
  | 'ranking'
  | 'context'
  | 'generating'
  | 'done'
  | 'error'

export interface GraphMatch {
  sectionId: number
  documentId: number
  document: string
  heading: string
  score: number
  via: 'exact' | 'fts'
  selected: boolean
  rank: number
}

export interface GraphDocument {
  documentId: number
  name: string
  best: number
  selected: boolean
}

interface GraphState {
  runId: string | null
  stage: GraphStage
  query: string
  analysis: QueryAnalysis | null
  totals: { sections: number; documents: number }
  candidates: number
  matches: GraphMatch[]
  documents: GraphDocument[]
  context: { sections: number; characters: number; estimatedTokens: number } | null
  sources: Source[]
  answerChars: number
  stats: GenerationStats | null
  timings: Timings | null
  message: string | null

  apply: (event: PipelineEvent) => void
  reset: () => void
}

const EMPTY = {
  runId: null,
  stage: 'idle' as GraphStage,
  query: '',
  analysis: null,
  totals: { sections: 0, documents: 0 },
  candidates: 0,
  matches: [] as GraphMatch[],
  documents: [] as GraphDocument[],
  context: null,
  sources: [] as Source[],
  answerChars: 0,
  stats: null,
  timings: null,
  message: null
}

function rebuildDocuments(matches: GraphMatch[]): GraphDocument[] {
  const byDocument = new Map<number, GraphDocument>()
  for (const match of matches) {
    const existing = byDocument.get(match.documentId)
    if (!existing) {
      byDocument.set(match.documentId, {
        documentId: match.documentId,
        name: match.document,
        best: match.score,
        selected: match.selected
      })
    } else {
      existing.best = Math.max(existing.best, match.score)
      existing.selected = existing.selected || match.selected
    }
  }
  return [...byDocument.values()].sort((a, b) => b.best - a.best)
}

/**
 * The graph is a projection of the real pipeline events — nothing is
 * synthesised here, every node comes from something that actually happened.
 */
export const useGraphStore = create<GraphState>((set, get) => ({
  ...EMPTY,

  reset: () => set({ ...EMPTY }),

  apply(event) {
    switch (event.type) {
      case 'query_received':
        set({ ...EMPTY, runId: event.runId, query: event.query, stage: 'analyzing' })
        break

      case 'query_analyzed':
        set({ analysis: event.analysis, stage: 'searching' })
        break

      case 'search_started':
        set({ totals: { sections: event.sections, documents: event.documents }, stage: 'searching' })
        break

      case 'search_match': {
        const matches = [...get().matches]
        if (!matches.some((m) => m.sectionId === event.sectionId)) {
          matches.push({
            sectionId: event.sectionId,
            documentId: event.documentId,
            document: event.document,
            heading: event.heading,
            score: event.score,
            via: event.via,
            selected: false,
            rank: matches.length + 1
          })
          set({ matches, documents: rebuildDocuments(matches) })
        }
        break
      }

      case 'search_completed':
        set({ candidates: event.candidates })
        break

      case 'ranking_started':
        set({ stage: 'ranking', candidates: event.candidates })
        break

      case 'ranking_completed': {
        const ranked = event.ranked.map((section, index) => ({
          sectionId: section.sectionId,
          documentId: section.documentId,
          document: section.relativePath,
          heading: section.heading,
          score: section.score,
          via: section.matchedSymbols.length > 0 ? ('exact' as const) : ('fts' as const),
          selected: section.selected,
          rank: index + 1
        }))
        set({ matches: ranked, documents: rebuildDocuments(ranked), stage: 'context' })
        break
      }

      case 'context_selected':
        set({
          context: {
            sections: event.sections,
            characters: event.characters,
            estimatedTokens: event.estimatedTokens
          },
          sources: event.sources
        })
        break

      case 'generation_started':
        set({ stage: 'generating' })
        break

      case 'generation_token':
        set({ answerChars: get().answerChars + event.token.length })
        break

      case 'generation_completed':
        set({ stage: 'done', stats: event.stats, timings: event.timings })
        break

      case 'cancelled':
        set({ stage: 'done', message: `cancelled during ${event.stage}` })
        break

      case 'error':
        set({ stage: 'error', message: event.message })
        break
    }
  }
}))

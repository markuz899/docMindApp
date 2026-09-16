import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DocMindDb } from '@main/database/client'
import { createConversation, listMessages, retrievalForQuery } from '@main/database/repositories'
import { ModelManager } from '@main/llm/manager'
import type { GenerateRequest, GenerationEvent, LLMProvider } from '@main/llm/types'
import { runAsk } from '@main/retrieval/pipeline'
import { DEFAULT_SETTINGS, type PipelineEvent } from '@shared/types'
import { indexedDemo } from './helpers'

const QUESTION = 'Mi hanno aperto un bug: la rotta /me riporta informazioni sbagliate'

class EchoProvider implements LLMProvider {
  lastPrompt = ''
  async initialize(): Promise<void> {}
  async healthCheck(): Promise<boolean> {
    return true
  }
  describe(): { provider: 'ollama'; model: string; contextSize: number; detail: string } {
    return { provider: 'ollama', model: 'echo', contextSize: 4096, detail: 'test double' }
  }
  async *generate(request: GenerateRequest): AsyncIterable<GenerationEvent> {
    this.lastPrompt = request.prompt
    yield { type: 'start', provider: 'ollama', model: 'echo' }
    for (const token of ['The ', '/me ', 'merge ', 'is ', 'the ', 'cause.']) {
      yield { type: 'token', token }
    }
    yield {
      type: 'done',
      stats: {
        promptTokens: 100,
        generatedTokens: 6,
        tokensPerSecond: 30,
        generationMs: 200,
        provider: 'ollama',
        model: 'echo'
      }
    }
  }
  async unload(): Promise<void> {}
}

function managerWith(provider: LLMProvider): ModelManager {
  const manager = new ModelManager({ ...DEFAULT_SETTINGS.model, provider: 'ollama', ollamaModel: 'echo' })
  vi.spyOn(manager as unknown as { build: () => LLMProvider }, 'build').mockReturnValue(provider)
  return manager
}

let db: DocMindDb
let projectId: number

beforeAll(async () => {
  const demo = await indexedDemo()
  db = demo.db
  projectId = demo.projectId
})

afterAll(() => db.close())

describe('ask pipeline', () => {
  it('emits the real pipeline events in order and answers from retrieval', async () => {
    const provider = new EchoProvider()
    const events: PipelineEvent[] = []
    const conversationId = createConversation(db, projectId, QUESTION)

    const result = await runAsk({
      db,
      projectId,
      conversationId,
      question: QUESTION,
      settings: DEFAULT_SETTINGS,
      models: managerWith(provider),
      emit: (event) => events.push(event)
    })

    const types = events.map((e) => e.type)
    expect(types[0]).toBe('query_received')
    expect(types).toContain('query_analyzed')
    expect(types).toContain('search_started')
    expect(types).toContain('search_match')
    expect(types).toContain('ranking_started')
    expect(types).toContain('ranking_completed')
    expect(types).toContain('context_selected')
    expect(types).toContain('generation_started')
    expect(types).toContain('generation_token')
    expect(types.at(-1)).toBe('generation_completed')

    // Every emitted event belongs to the same run.
    expect(new Set(events.map((e) => e.runId)).size).toBe(1)

    const analyzed = events.find((e) => e.type === 'query_analyzed')
    expect(analyzed && analyzed.type === 'query_analyzed' && analyzed.analysis.symbols).toContain('/me')

    const started = events.find((e) => e.type === 'search_started')
    expect(started && started.type === 'search_started' && started.sections).toBeGreaterThan(30)

    // search_match events must describe sections that really exist.
    for (const event of events.filter((e) => e.type === 'search_match')) {
      if (event.type !== 'search_match') continue
      const row = db.raw.prepare(`SELECT id FROM sections WHERE id = ?`).get(event.sectionId)
      expect(row).toBeTruthy()
      expect(event.score).toBeGreaterThanOrEqual(0)
      expect(event.score).toBeLessThanOrEqual(1)
    }

    expect(result.answer).toBe('The /me merge is the cause.')
    expect(result.sources.length).toBeGreaterThanOrEqual(3)
    expect(result.sources.some((s) => s.heading === 'GET /me')).toBe(true)
    expect(provider.lastPrompt).toContain('GET /me')
    expect(provider.lastPrompt).toContain('UserService')
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0)
  })

  it('persists the query, its retrieval results and both messages', async () => {
    const conversationId = createConversation(db, projectId, 'persist')
    await runAsk({
      db,
      projectId,
      conversationId,
      question: 'Where is GET /me documented?',
      settings: DEFAULT_SETTINGS,
      models: managerWith(new EchoProvider()),
      emit: () => undefined
    })

    const messages = listMessages(db, conversationId)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[1]?.sources.length).toBeGreaterThan(0)

    const queryId = messages[0]?.analysis ? (messages[1]?.id ?? 0) : 0
    expect(queryId).toBeGreaterThan(0)

    const stored = retrievalForQuery(db, (db.raw.prepare(`SELECT max(id) AS id FROM queries`).get() as { id: number }).id)
    expect(stored.length).toBeGreaterThan(0)
    expect(stored[0]?.rank).toBe(1)
    expect(stored.some((r) => r.selected)).toBe(true)
  })

  it('still returns the retrieved sources when no model can answer', async () => {
    const conversationId = createConversation(db, projectId, 'no model')
    const events: PipelineEvent[] = []

    const result = await runAsk({
      db,
      projectId,
      conversationId,
      question: 'Where is GET /me documented?',
      settings: DEFAULT_SETTINGS,
      models: new ModelManager(DEFAULT_SETTINGS.model),
      emit: (event) => events.push(event)
    })

    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.answer).toContain('GET /me')
  })

  it('reports that nothing matched instead of inventing an answer', async () => {
    const conversationId = createConversation(db, projectId, 'unmatched')
    const result = await runAsk({
      db,
      projectId,
      conversationId,
      question: 'zzzqqq',
      settings: DEFAULT_SETTINGS,
      models: managerWith(new EchoProvider()),
      emit: () => undefined
    })
    expect(result.answer).toMatch(/does not contain/)
    expect(result.sources).toHaveLength(0)
  })
})

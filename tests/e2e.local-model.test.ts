/**
 * End-to-end check against a real local model. Skipped by default because it
 * needs a running Ollama daemon or a GGUF file on disk.
 *
 *   DOCMIND_E2E=1 npm run test -- tests/e2e.local-model.test.ts
 *   DOCMIND_GGUF=/path/to/model.gguf DOCMIND_E2E=1 npm run test -- tests/e2e.local-model.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DocMindDb } from '@main/database/client'
import { createConversation } from '@main/database/repositories'
import { LocalGGUFProvider, inspectGguf } from '@main/llm/gguf'
import { ModelManager } from '@main/llm/manager'
import { listOllamaModels } from '@main/llm/ollama'
import { runAsk } from '@main/retrieval/pipeline'
import { DEFAULT_SETTINGS, type PipelineEvent } from '@shared/types'
import { indexedDemo } from './helpers'

const QUESTION = 'Mi hanno aperto un bug: la rotta /me riporta informazioni sbagliate'
const enabled = process.env.DOCMIND_E2E === '1'
const ggufPath = process.env.DOCMIND_GGUF ?? ''

let db: DocMindDb
let projectId: number

beforeAll(async () => {
  if (!enabled) return
  const demo = await indexedDemo()
  db = demo.db
  projectId = demo.projectId
})

afterAll(() => db?.close())

describe.runIf(enabled)('local model end to end', () => {
  it('answers the demo question through Ollama', { timeout: 180_000 }, async () => {
    const models = await listOllamaModels(DEFAULT_SETTINGS.model.ollamaUrl)
    expect(models.length).toBeGreaterThan(0)
    const model = models[0]?.name as string

    const events: PipelineEvent[] = []
    const manager = new ModelManager({
      ...DEFAULT_SETTINGS.model,
      provider: 'ollama',
      ollamaModel: model
    })

    const result = await runAsk({
      db,
      projectId,
      conversationId: createConversation(db, projectId, QUESTION),
      question: QUESTION,
      settings: DEFAULT_SETTINGS,
      models: manager,
      emit: (event) => events.push(event)
    })

    console.log('\n--- sources -------------------------------------------------')
    for (const [index, source] of result.sources.entries()) {
      console.log(`[${index + 1}] ${source.relativePath} :: ${source.headingPath}  ${(source.relevance * 100).toFixed(0)}%`)
    }
    console.log('--- answer --------------------------------------------------')
    console.log(result.answer.trim())
    console.log('--- timings -------------------------------------------------')
    console.log(result.timings, result.stats)

    expect(result.sources.some((s) => s.heading === 'GET /me')).toBe(true)
    expect(result.answer.length).toBeGreaterThan(80)
    expect(events.filter((e) => e.type === 'generation_token').length).toBeGreaterThan(10)
    expect(result.stats?.generatedTokens ?? 0).toBeGreaterThan(0)
  })

  it.runIf(ggufPath !== '')('loads and generates with a real GGUF file', { timeout: 300_000 }, async () => {
    const info = await inspectGguf(ggufPath)
    console.log('\n--- gguf ----------------------------------------------------')
    console.log(info)
    expect(info.valid).toBe(true)

    const provider = new LocalGGUFProvider({
      ...DEFAULT_SETTINGS.model,
      provider: 'local-gguf',
      modelPath: ggufPath,
      contextSize: 2048,
      maxTokens: 96
    })
    await provider.initialize()
    expect(await provider.healthCheck()).toBe(true)

    let answer = ''
    let done = false
    for await (const event of provider.generate({
      systemPrompt: 'Answer with a single short sentence.',
      prompt: 'QUESTION\n\nWhat does the route GET /me return?\n\nDOCUMENTATION\n\n[SOURCE 1]\nFile: 04-api-reference.md\nHeading: GET /me\n\nReturns the authenticated user record merged with their profile.\n\nINSTRUCTIONS\n\n- Answer using only the documentation.',
      temperature: 0,
      maxTokens: 96
    })) {
      if (event.type === 'token') answer += event.token
      if (event.type === 'done') done = true
      if (event.type === 'error') throw new Error(event.message)
    }
    await provider.unload()

    console.log('--- gguf answer ---------------------------------------------')
    console.log(answer.trim())
    expect(done).toBe(true)
    expect(answer.trim().length).toBeGreaterThan(10)
  })

  it.runIf(ggufPath !== '')(
    'answers repeatedly without running out of context sequences',
    { timeout: 300_000 },
    async () => {
      // A context owns a fixed number of sequences. If a generation does not
      // release the one it took, the next question dies with "No sequences
      // left" and the provider has to be rebuilt to recover - which looks, from
      // the outside, like every other question failing.
      const provider = new LocalGGUFProvider({
        ...DEFAULT_SETTINGS.model,
        provider: 'local-gguf',
        modelPath: ggufPath,
        contextSize: 2048,
        maxTokens: 24
      })
      await provider.initialize()

      for (const attempt of [1, 2, 3]) {
        let text = ''
        let finished = false
        for await (const event of provider.generate({
          systemPrompt: 'Answer in one short sentence.',
          prompt: 'What does the route GET /me return?',
          temperature: 0,
          maxTokens: 24
        })) {
          if (event.type === 'token') text += event.token
          if (event.type === 'done') finished = true
          if (event.type === 'error') throw new Error(`attempt ${attempt}: ${event.message}`)
        }
        expect(finished, `attempt ${attempt} did not finish`).toBe(true)
        expect(text.trim().length, `attempt ${attempt} produced nothing`).toBeGreaterThan(0)
      }

      await provider.unload()
    }
  )
})

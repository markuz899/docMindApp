/**
 * End-to-end check against the real Codex and Claude Code CLIs.
 *
 * Skipped by default: it spends the user's plan quota, so `npm test` must never
 * trigger it. Each provider also needs its API-key environment variable absent,
 * which is exactly the configuration the providers require at runtime.
 *
 *   env -u OPENAI_API_KEY DOCMIND_E2E_CODEX=1 npm run test -- tests/e2e.subscription.test.ts
 *   env -u ANTHROPIC_API_KEY DOCMIND_E2E_CLAUDE=1 npm run test -- tests/e2e.subscription.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DocMindDb } from '@main/database/client'
import { createConversation } from '@main/database/repositories'
import { ModelManager } from '@main/llm/manager'
import { detectClaude } from '@main/llm/claude-code'
import { detectCodex } from '@main/llm/codex'
import { runAsk } from '@main/retrieval/pipeline'
import { DEFAULT_SETTINGS, type PipelineEvent, type ProviderId, type Settings } from '@shared/types'
import { indexedDemo } from './helpers'

const QUESTION = 'What does the route GET /me return?'
const codexEnabled = process.env.DOCMIND_E2E_CODEX === '1'
const claudeEnabled = process.env.DOCMIND_E2E_CLAUDE === '1'

let db: DocMindDb
let projectId: number

beforeAll(async () => {
  if (!codexEnabled && !claudeEnabled) return
  const demo = await indexedDemo()
  db = demo.db
  projectId = demo.projectId
})

afterAll(() => db?.close())

function settingsFor(provider: ProviderId): Settings {
  return {
    ...DEFAULT_SETTINGS,
    model: { ...DEFAULT_SETTINGS.model, provider, maxTokens: 400 },
    providers: { ...DEFAULT_SETTINGS.providers, privacyAcknowledged: [provider] }
  }
}

async function askThrough(provider: ProviderId): Promise<void> {
  const settings = settingsFor(provider)
  const events: PipelineEvent[] = []
  const manager = new ModelManager(settings.model, settings.providers)

  const result = await runAsk({
    db,
    projectId,
    conversationId: createConversation(db, projectId, QUESTION),
    question: QUESTION,
    settings,
    models: manager,
    emit: (event) => events.push(event)
  })

  console.log(`\n--- ${provider}: pipeline stages ----------------------------`)
  console.log([...new Set(events.map((event) => event.type))].join(' -> '))
  console.log(`--- ${provider}: sources ------------------------------------`)
  for (const [index, source] of result.sources.entries()) {
    console.log(`[${index + 1}] ${source.relativePath} :: ${source.headingPath}`)
  }
  console.log(`--- ${provider}: answer -------------------------------------`)
  console.log(result.answer.trim())
  console.log(`--- ${provider}: stats --------------------------------------`)
  console.log(result.stats)

  // The whole chain has to be real: retrieval -> context -> provider -> answer.
  expect(events.some((event) => event.type === 'context_selected')).toBe(true)
  expect(result.sources.length).toBeGreaterThan(0)
  const started = events.find((event) => event.type === 'generation_started')
  expect(started && 'provider' in started ? started.provider : null).toBe(provider)
  expect(result.answer.trim().length).toBeGreaterThan(40)
  expect(result.stats?.provider).toBe(provider)
  await manager.unload()
}

describe.runIf(codexEnabled)('Codex CLI end to end', () => {
  it('reports a ready provider', { timeout: 60_000 }, async () => {
    const health = await detectCodex({ acknowledged: true })
    console.log('\n--- codex health --------------------------------------------')
    console.log(health)
    expect(health.state).toBe('ready')
  })

  it('answers the demo question through the Codex CLI', { timeout: 300_000 }, async () => {
    await askThrough('codex-cli')
  })
})

describe.runIf(claudeEnabled)('Claude Code CLI end to end', () => {
  it('reports a ready provider', { timeout: 60_000 }, async () => {
    const health = await detectClaude({ acknowledged: true })
    console.log('\n--- claude health -------------------------------------------')
    console.log(health)
    expect(health.state).toBe('ready')
  })

  it('answers the demo question through Claude Code', { timeout: 300_000 }, async () => {
    await askThrough('claude-code-cli')
  })
})

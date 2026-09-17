import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ModelManager } from '@main/llm/manager'
import { LLMError, TokenQueue, type GenerateRequest, type GenerationEvent, type LLMProvider } from '@main/llm/types'
import { inspectGguf } from '@main/llm/gguf'
import { DEFAULT_SETTINGS } from '@shared/types'

class StubProvider implements LLMProvider {
  initialized = false
  unloaded = false

  constructor(private chunks: string[]) {}

  async initialize(): Promise<void> {
    this.initialized = true
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized
  }

  describe(): { provider: 'ollama'; model: string; contextSize: number; detail: string } {
    return { provider: 'ollama', model: 'stub', contextSize: 2048, detail: 'stub' }
  }

  async *generate(request: GenerateRequest): AsyncIterable<GenerationEvent> {
    yield { type: 'start', provider: 'ollama', model: 'stub' }
    for (const chunk of this.chunks) {
      if (request.signal?.aborted) return
      yield { type: 'token', token: chunk }
    }
    yield {
      type: 'done',
      stats: {
        promptTokens: 10,
        generatedTokens: this.chunks.length,
        tokensPerSecond: 12.5,
        generationMs: 80,
        provider: 'ollama',
        model: 'stub'
      }
    }
  }

  async unload(): Promise<void> {
    this.unloaded = true
    this.initialized = false
  }
}

async function collect(stream: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('LLMProvider contract', () => {
  it('streams start, tokens and done in order', async () => {
    const provider = new StubProvider(['Hello', ' ', 'world'])
    await provider.initialize()
    const events = await collect(provider.generate({ systemPrompt: 's', prompt: 'p', temperature: 0, maxTokens: 10 }))

    expect(events.map((e) => e.type)).toEqual(['start', 'token', 'token', 'token', 'done'])
    expect(events.filter((e) => e.type === 'token').map((e) => (e as { token: string }).token).join('')).toBe(
      'Hello world'
    )
  })

  it('stops when the request is aborted', async () => {
    const provider = new StubProvider(['a', 'b', 'c'])
    const controller = new AbortController()
    controller.abort()
    const events = await collect(
      provider.generate({ systemPrompt: '', prompt: '', temperature: 0, maxTokens: 10, signal: controller.signal })
    )
    expect(events.map((e) => e.type)).toEqual(['start'])
  })

  it('releases resources on unload', async () => {
    const provider = new StubProvider([])
    await provider.initialize()
    await provider.unload()
    expect(provider.unloaded).toBe(true)
    expect(await provider.healthCheck()).toBe(false)
  })
})

describe('ModelManager', () => {
  it('refuses to generate when no provider is configured', async () => {
    const manager = new ModelManager(DEFAULT_SETTINGS.model)
    await expect(manager.ensureReady()).rejects.toBeInstanceOf(LLMError)
    expect(manager.status().state).toBe('error')
    expect(await manager.healthCheck()).toBe(false)
  })

  it('reports the generating state while streaming and returns to ready', async () => {
    const manager = new ModelManager({ ...DEFAULT_SETTINGS.model, provider: 'ollama', ollamaModel: 'stub' })
    const provider = new StubProvider(['one', 'two'])
    vi.spyOn(manager as unknown as { build: () => LLMProvider }, 'build').mockReturnValue(provider)

    const seen: string[] = []
    manager.onStatusChange((status) => seen.push(status.state))
    const events = await collect(manager.generate({ systemPrompt: '', prompt: '', temperature: 0, maxTokens: 4 }))

    expect(events.at(-1)?.type).toBe('done')
    expect(seen).toContain('generating')
    expect(manager.status().state).toBe('ready')
  })

  it('unloads the provider when the model settings change', async () => {
    const manager = new ModelManager({ ...DEFAULT_SETTINGS.model, provider: 'ollama', ollamaModel: 'stub' })
    const provider = new StubProvider([])
    vi.spyOn(manager as unknown as { build: () => LLMProvider }, 'build').mockReturnValue(provider)

    await manager.ensureReady()
    expect(manager.status().state).toBe('ready')
    await manager.applySettings({ ...DEFAULT_SETTINGS.model, provider: 'ollama', ollamaModel: 'other' })
    expect(provider.unloaded).toBe(true)
    expect(manager.status().state).toBe('unloaded')
  })
})

describe('TokenQueue', () => {
  it('delivers tokens pushed before and after a consumer attaches', async () => {
    const queue = new TokenQueue()
    queue.push('a')
    const collected: string[] = []
    const consumer = (async () => {
      for await (const token of queue.drain()) collected.push(token)
    })()
    queue.push('b')
    queue.end()
    await consumer
    expect(collected).toEqual(['a', 'b'])
  })
})

describe('GGUF inspection', () => {
  it('reports a missing file instead of throwing', async () => {
    const info = await inspectGguf('/no/such/model.gguf')
    expect(info.valid).toBe(false)
    expect(info.problem).toBe('file not found')
  })

  it('rejects a file that is not a .gguf', async () => {
    const info = await inspectGguf(fileURLToPath(import.meta.url))
    expect(info.valid).toBe(false)
    expect(info.problem).toBe('not a .gguf file')
  })
})

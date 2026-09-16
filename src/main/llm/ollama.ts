import type { ModelSettings, OllamaModelInfo } from '@shared/types'
import { LLMError, type GenerateRequest, type GenerationEvent, type LLMProvider, type ProviderDescription } from './types'

interface OllamaChunk {
  message?: { content?: string; thinking?: string }
  done?: boolean
  prompt_eval_count?: number
  eval_count?: number
  eval_duration?: number
}

interface OllamaTag {
  name: string
  size: number
}

/** Secondary provider: no extra dependency, plain HTTP against a local daemon. */
export class OllamaProvider implements LLMProvider {
  private ready = false

  constructor(private settings: ModelSettings) {}

  private get baseUrl(): string {
    return this.settings.ollamaUrl.replace(/\/$/, '')
  }

  describe(): ProviderDescription {
    return {
      provider: 'ollama',
      model: this.settings.ollamaModel,
      contextSize: this.settings.contextSize,
      detail: `ollama · ${this.baseUrl}`
    }
  }

  async initialize(): Promise<void> {
    if (!this.settings.ollamaModel) {
      throw new LLMError('No Ollama model selected. Pick one on the Models page.', 'no_model')
    }
    const models = await listOllamaModels(this.settings.ollamaUrl)
    if (!models.some((m) => m.name === this.settings.ollamaModel)) {
      throw new LLMError(
        `Ollama does not have "${this.settings.ollamaModel}". Run: ollama pull ${this.settings.ollamaModel}`,
        'no_model'
      )
    }
    this.ready = true
  }

  async healthCheck(): Promise<boolean> {
    try {
      await listOllamaModels(this.settings.ollamaUrl)
      return this.ready
    } catch {
      return false
    }
  }

  async *generate(request: GenerateRequest): AsyncIterable<GenerationEvent> {
    if (!this.ready) await this.initialize()
    const model = this.settings.ollamaModel
    yield { type: 'start', provider: 'ollama', model }

    const startedAt = Date.now()

    const body = (think: boolean): string =>
      JSON.stringify({
        model,
        stream: true,
        // Reasoning models would otherwise spend the whole token budget on a
        // "thinking" block that never reaches message.content.
        ...(think ? {} : { think: false }),
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
          num_ctx: this.settings.contextSize
        },
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.prompt }
        ]
      })

    const post = (payload: string): Promise<Response> =>
      fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: request.signal ?? null,
        body: payload
      })

    let response: Response
    try {
      response = await post(body(false))
      // Older daemons reject the `think` field outright; retry without it.
      if (response.status === 400) response = await post(body(true))
    } catch (error) {
      yield { type: 'error', message: `Ollama is unreachable at ${this.baseUrl}: ${(error as Error).message}` }
      return
    }

    if (!response.ok || !response.body) {
      yield { type: 'error', message: `Ollama returned HTTP ${response.status}` }
      return
    }

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ''
    let promptTokens = 0
    let generatedTokens = 0

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (line === '') continue

          let chunk: OllamaChunk
          try {
            chunk = JSON.parse(line) as OllamaChunk
          } catch {
            continue
          }
          const token = chunk.message?.content
          if (token) yield { type: 'token', token }
          if (chunk.prompt_eval_count) promptTokens = chunk.prompt_eval_count
          if (chunk.eval_count) generatedTokens = chunk.eval_count
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        yield { type: 'error', message: (error as Error).message }
        return
      }
    }

    const generationMs = Date.now() - startedAt
    yield {
      type: 'done',
      stats: {
        promptTokens,
        generatedTokens,
        tokensPerSecond: generationMs > 0 ? (generatedTokens / generationMs) * 1000 : 0,
        generationMs,
        provider: 'ollama',
        model
      }
    }
  }

  async unload(): Promise<void> {
    this.ready = false
  }
}

export async function listOllamaModels(baseUrl: string): Promise<OllamaModelInfo[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tags`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as { models?: OllamaTag[] }
    return (payload.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size }))
  } catch (error) {
    throw new LLMError(`Ollama is not reachable at ${baseUrl}: ${(error as Error).message}`, 'unavailable')
  } finally {
    clearTimeout(timer)
  }
}

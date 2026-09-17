import type { GenerationStats, ProviderId } from '@shared/types'

export interface GenerateRequest {
  systemPrompt: string
  prompt: string
  temperature: number
  maxTokens: number
  signal?: AbortSignal
}

export type GenerationEvent =
  | { type: 'start'; provider: string; model: string }
  | { type: 'token'; token: string }
  | { type: 'done'; stats: GenerationStats }
  | { type: 'error'; message: string }

export interface ProviderDescription {
  provider: ProviderId
  model: string
  contextSize: number
  detail: string
}

export interface LLMProvider {
  initialize(): Promise<void>
  healthCheck(): Promise<boolean>
  generate(request: GenerateRequest): AsyncIterable<GenerationEvent>
  unload(): Promise<void>
  describe(): ProviderDescription
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'no_model'
      | 'invalid_model'
      | 'load_failed'
      | 'context_too_large'
      | 'generation_failed'
      | 'unavailable'
      | 'not_installed'
      | 'not_authenticated'
      | 'api_billing_risk'
      | 'usage_limit'
      | 'not_acknowledged'
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

/** Bridges callback-style token streams into an async iterable. */
export class TokenQueue {
  private items: string[] = []
  private waiters: (() => void)[] = []
  private ended = false

  push(token: string): void {
    this.items.push(token)
    this.wake()
  }

  end(): void {
    this.ended = true
    this.wake()
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter()
  }

  async *drain(): AsyncGenerator<string> {
    for (;;) {
      while (this.items.length > 0) yield this.items.shift() as string
      if (this.ended) return
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }
}

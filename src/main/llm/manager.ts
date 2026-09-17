import { DEFAULT_SETTINGS, PROVIDER_LABEL, type ModelSettings, type ModelState, type ModelStatus, type ProviderSettings } from '@shared/types'
import { ClaudeCodeCliProvider } from './claude-code'
import { CodexCliProvider } from './codex'
import { LocalGGUFProvider } from './gguf'
import { OllamaProvider } from './ollama'
import { LLMError, type GenerateRequest, type GenerationEvent, type LLMProvider } from './types'

type Listener = (status: ModelStatus) => void

/** Owns the single active provider and keeps the toolbar status truthful. */
export class ModelManager {
  private provider: LLMProvider | null = null
  private settings: ModelSettings
  private providers: ProviderSettings
  private state: ModelState = 'unloaded'
  private lastError: string | null = null
  private listeners = new Set<Listener>()

  constructor(settings: ModelSettings, providers: ProviderSettings = DEFAULT_SETTINGS.providers) {
    this.settings = settings
    this.providers = providers
  }

  onStatusChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const status = this.status()
    for (const listener of this.listeners) listener(status)
  }

  private setState(state: ModelState, error: string | null = null): void {
    this.state = state
    this.lastError = error
    this.emit()
  }

  /** Shown before a provider is loaded, so the toolbar is never blank. */
  private fallbackModelName(): string {
    if (this.settings.provider === 'ollama') return this.settings.ollamaModel
    if (this.settings.provider === 'codex-cli') return this.providers.codexModel || PROVIDER_LABEL['codex-cli']
    if (this.settings.provider === 'claude-code-cli') {
      return this.providers.claudeModel || PROVIDER_LABEL['claude-code-cli']
    }
    return ''
  }

  status(): ModelStatus {
    const description = this.provider?.describe()
    return {
      state: this.state,
      provider: this.settings.provider,
      model: description?.model ?? this.fallbackModelName(),
      detail: description?.detail ?? '',
      contextSize: description?.contextSize ?? this.settings.contextSize,
      lastError: this.lastError
    }
  }

  async applySettings(settings: ModelSettings, providers: ProviderSettings = this.providers): Promise<void> {
    const changed =
      JSON.stringify(settings) !== JSON.stringify(this.settings) ||
      JSON.stringify(providers) !== JSON.stringify(this.providers)
    this.settings = settings
    this.providers = providers
    if (changed) {
      await this.unload()
    }
    this.emit()
  }

  private build(): LLMProvider {
    if (this.settings.provider === 'local-gguf') return new LocalGGUFProvider(this.settings)
    if (this.settings.provider === 'ollama') return new OllamaProvider(this.settings)
    if (this.settings.provider === 'codex-cli') return new CodexCliProvider(this.providers)
    if (this.settings.provider === 'claude-code-cli') return new ClaudeCodeCliProvider(this.providers)
    throw new LLMError('No model is configured. Open the AI Models page to pick one.', 'no_model')
  }

  async ensureReady(): Promise<LLMProvider> {
    if (this.provider && this.state === 'ready') return this.provider
    this.setState('loading')
    try {
      const provider = this.build()
      await provider.initialize()
      this.provider = provider
      this.setState('ready')
      return provider
    } catch (error) {
      this.provider = null
      this.setState('error', (error as Error).message)
      throw error
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const provider = await this.ensureReady()
      return await provider.healthCheck()
    } catch {
      return false
    }
  }

  async *generate(request: GenerateRequest): AsyncIterable<GenerationEvent> {
    const provider = await this.ensureReady()
    this.setState('generating')
    try {
      for await (const event of provider.generate(request)) {
        if (event.type === 'error') this.lastError = event.message
        yield event
      }
      this.setState(this.lastError ? 'error' : 'ready', this.lastError)
    } catch (error) {
      this.setState('error', (error as Error).message)
      throw error
    }
  }

  async unload(): Promise<void> {
    await this.provider?.unload().catch(() => undefined)
    this.provider = null
    this.setState('unloaded')
  }
}

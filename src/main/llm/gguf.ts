import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Llama, LlamaContext, LlamaModel } from 'node-llama-cpp'
import type { GgufFileInfo, ModelSettings } from '@shared/types'
import { LLMError, TokenQueue, type GenerateRequest, type GenerationEvent, type LLMProvider, type ProviderDescription } from './types'

// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- the module is optional and ESM-only
type LlamaModule = typeof import('node-llama-cpp')

let modulePromise: Promise<LlamaModule> | null = null

/** node-llama-cpp is ESM-only and optional; load it lazily and never crash. */
export async function loadLlamaModule(): Promise<LlamaModule> {
  if (!modulePromise) {
    modulePromise = import('node-llama-cpp').catch((error: unknown) => {
      modulePromise = null
      throw new LLMError(
        `node-llama-cpp is not available: ${(error as Error).message}. Install it or switch to the Ollama provider.`,
        'unavailable'
      )
    })
  }
  return modulePromise
}

function formatParameterCount(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e10 ? 0 : 1)}B`
  if (value >= 1e6) return `${Math.round(value / 1e6)}M`
  return String(value)
}

/** Reads GGUF metadata without loading weights, so the Models page stays fast. */
export async function inspectGguf(filePath: string): Promise<GgufFileInfo> {
  const filename = path.basename(filePath)
  const base: GgufFileInfo = {
    path: filePath,
    filename,
    sizeBytes: 0,
    contextSize: null,
    architecture: null,
    parameters: null,
    valid: false,
    problem: null
  }

  try {
    base.sizeBytes = fs.statSync(filePath).size
  } catch {
    return { ...base, problem: 'file not found' }
  }
  if (path.extname(filePath).toLowerCase() !== '.gguf') {
    return { ...base, problem: 'not a .gguf file' }
  }

  try {
    const { readGgufFileInfo } = await loadLlamaModule()
    const info = await readGgufFileInfo(filePath)
    const metadata = info.metadata as Record<string, unknown>
    const general = (metadata.general ?? {}) as Record<string, unknown>
    const architecture = typeof general.architecture === 'string' ? general.architecture : null
    const arch = architecture ? ((metadata[architecture] ?? {}) as Record<string, unknown>) : {}
    const contextLength = typeof arch.context_length === 'number' ? arch.context_length : null

    const sizeLabel = typeof general.size_label === 'string' ? general.size_label : null
    const parameterCount = typeof general.parameter_count === 'number' ? general.parameter_count : undefined

    return {
      ...base,
      valid: true,
      architecture,
      contextSize: contextLength,
      parameters: sizeLabel ?? formatParameterCount(parameterCount)
    }
  } catch (error) {
    return { ...base, problem: `invalid or unreadable GGUF: ${(error as Error).message}` }
  }
}

export class LocalGGUFProvider implements LLMProvider {
  private llama: Llama | null = null
  private model: LlamaModel | null = null
  private context: LlamaContext | null = null
  private loadedPath = ''

  constructor(private settings: ModelSettings) {}

  describe(): ProviderDescription {
    return {
      provider: 'local-gguf',
      model: this.settings.modelPath ? path.basename(this.settings.modelPath) : '',
      contextSize: this.context?.contextSize ?? this.settings.contextSize,
      detail: this.loadedPath ? `llama.cpp · ${this.llama?.gpu || 'cpu'}` : 'llama.cpp'
    }
  }

  async initialize(): Promise<void> {
    const modelPath = this.settings.modelPath
    if (!modelPath) throw new LLMError('No GGUF model selected. Pick one on the Models page.', 'no_model')
    if (!fs.existsSync(modelPath)) throw new LLMError(`Model file not found: ${modelPath}`, 'no_model')
    if (this.context && this.loadedPath === modelPath) return

    await this.unload()

    const { getLlama } = await loadLlamaModule()
    try {
      this.llama = await getLlama({ build: 'never' })
      this.model = await this.llama.loadModel({
        modelPath,
        gpuLayers: this.settings.gpuLayers < 0 ? undefined : this.settings.gpuLayers
      })
      this.context = await this.model.createContext({
        contextSize: { max: this.settings.contextSize },
        threads: this.settings.threads > 0 ? this.settings.threads : undefined
      })
      this.loadedPath = modelPath
    } catch (error) {
      await this.unload()
      throw new LLMError(`Could not load ${path.basename(modelPath)}: ${(error as Error).message}`, 'load_failed')
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.context !== null && this.model !== null
  }

  async *generate(request: GenerateRequest): AsyncIterable<GenerationEvent> {
    await this.initialize()
    const model = this.model
    const context = this.context
    if (!model || !context) {
      yield { type: 'error', message: 'model not loaded' }
      return
    }

    const promptTokens = model.tokenize(`${request.systemPrompt}\n${request.prompt}`).length
    if (promptTokens >= context.contextSize) {
      yield {
        type: 'error',
        message: `The built context is ${promptTokens} tokens but the model context is ${context.contextSize}. Lower "max context characters" in Settings › Retrieval or raise the context size.`
      }
      return
    }

    const { LlamaChatSession } = await loadLlamaModule()
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: request.systemPrompt
    })

    yield { type: 'start', provider: 'local-gguf', model: path.basename(this.loadedPath) }

    const queue = new TokenQueue()
    let generatedTokens = 0
    let failure: Error | null = null
    const startedAt = Date.now()

    const run = session
      .prompt(request.prompt, {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        signal: request.signal,
        onTextChunk: (chunk: string) => queue.push(chunk),
        onToken: (tokens: number[]) => {
          generatedTokens += tokens.length
        }
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') failure = error as Error
      })
      .finally(() => {
        queue.end()
        session.dispose()
      })

    for await (const token of queue.drain()) yield { type: 'token', token }
    await run

    if (failure) {
      yield { type: 'error', message: (failure as Error).message }
      return
    }

    const generationMs = Date.now() - startedAt
    yield {
      type: 'done',
      stats: {
        promptTokens,
        generatedTokens,
        tokensPerSecond: generationMs > 0 ? (generatedTokens / generationMs) * 1000 : 0,
        generationMs,
        provider: 'local-gguf',
        model: path.basename(this.loadedPath)
      }
    }
  }

  async unload(): Promise<void> {
    await this.context?.dispose().catch(() => undefined)
    await this.model?.dispose().catch(() => undefined)
    this.context = null
    this.model = null
    this.llama = null
    this.loadedPath = ''
  }
}

export function defaultThreadCount(): number {
  return Math.max(1, Math.min(8, os.cpus().length - 1))
}

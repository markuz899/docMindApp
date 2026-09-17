import { describe, expect, it } from 'vitest'
import { ClaudeCodeCliProvider, claudeFailureMessage, detectClaude } from '@main/llm/claude-code'
import { CodexCliProvider, codexFailureMessage, detectCodex } from '@main/llm/codex'
import { classifyCliFailure } from '@main/llm/cli'
import { ModelManager } from '@main/llm/manager'
import { LLMError, type GenerationEvent } from '@main/llm/types'
import { saveSettings, loadSettings } from '@main/settings'
import { memoryDb } from './helpers'
import {
  DEFAULT_SETTINGS,
  PROVIDER_KIND,
  PROVIDER_PRIVACY,
  type ProviderId,
  type ProviderSettings
} from '@shared/types'

/** Stand-in for a CLI: no process is spawned and no plan quota is used. */
function runner(responses: Record<string, { code: number; stdout?: string; stderr?: string }>) {
  return async (_command: string, args: string[]) => {
    const key = args.join(' ')
    const response = responses[key] ?? { code: 127, stderr: `unexpected call: ${key}` }
    return { code: response.code, stdout: response.stdout ?? '', stderr: response.stderr ?? '' }
  }
}

const CODEX_READY = {
  '--version': { code: 0, stdout: 'codex-cli 0.154.0' },
  'login status': { code: 0, stdout: 'Logged in using ChatGPT' }
}

const CLAUDE_READY = {
  '--version': { code: 0, stdout: '2.1.274 (Claude Code)' },
  'auth status --json': {
    code: 0,
    stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiKeySource: 'none' })
  }
}

function providerSettings(patch: Partial<ProviderSettings> = {}): ProviderSettings {
  return { ...DEFAULT_SETTINGS.providers, ...patch }
}

async function collect(stream: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

/* ------------------------------------------------------------------ */

describe('Codex detection', () => {
  it('reports NOT_INSTALLED when the binary is missing', async () => {
    const health = await detectCodex({ run: runner({}), env: {} })
    expect(health.state).toBe('not_installed')
    expect(health.setupHint).toMatch(/codex login/)
    expect(health.version).toBeNull()
  })

  it('reports INSTALLED_NOT_AUTHENTICATED when login status fails', async () => {
    const health = await detectCodex({
      run: runner({ '--version': { code: 0, stdout: 'codex-cli 0.154.0' }, 'login status': { code: 1, stderr: 'Not logged in' } }),
      env: {}
    })
    expect(health.state).toBe('not_authenticated')
    expect(health.version).toBe('codex-cli 0.154.0')
  })

  it('reports READY for a signed-in CLI with no API key in the environment', async () => {
    const health = await detectCodex({ run: runner(CODEX_READY), env: {} })
    expect(health.state).toBe('ready')
    expect(health.kind).toBe('subscription')
    expect(health.privacy).toBe(PROVIDER_PRIVACY['codex-cli'])
  })
})

describe('Claude Code detection', () => {
  it('reports NOT_INSTALLED when the binary is missing', async () => {
    const health = await detectClaude({ run: runner({}), env: {} })
    expect(health.state).toBe('not_installed')
    expect(health.setupHint).toMatch(/claude auth login/)
  })

  it('reports INSTALLED_NOT_AUTHENTICATED when no account is signed in', async () => {
    const health = await detectClaude({
      run: runner({
        '--version': { code: 0, stdout: '2.1.274 (Claude Code)' },
        'auth status --json': { code: 0, stdout: JSON.stringify({ loggedIn: false }) }
      }),
      env: {}
    })
    expect(health.state).toBe('not_authenticated')
  })

  it('reports READY for a signed-in subscription account', async () => {
    const health = await detectClaude({ run: runner(CLAUDE_READY), env: {} })
    expect(health.state).toBe('ready')
    expect(health.detail).toMatch(/claude\.ai/)
  })
})

describe('environment safety', () => {
  it('blocks Claude Code when ANTHROPIC_API_KEY is in the environment', async () => {
    const health = await detectClaude({ run: runner(CLAUDE_READY), env: { ANTHROPIC_API_KEY: 'sk-ant-xxx' } })
    expect(health.state).toBe('api_billing_risk')
    expect(health.detail).toContain('ANTHROPIC_API_KEY detected.')
    expect(health.detail).toContain('may use API billing instead of your Claude subscription')
    expect(health.detail).toContain('Remove the environment variable or explicitly acknowledge this configuration.')
  })

  it('also blocks when the CLI itself reports an API key source', async () => {
    const health = await detectClaude({
      run: runner({
        ...CLAUDE_READY,
        'auth status --json': {
          code: 0,
          stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiKeySource: 'ANTHROPIC_API_KEY' })
        }
      }),
      env: {}
    })
    expect(health.state).toBe('api_billing_risk')
  })

  it('only enables Claude with an API key present after an explicit acknowledgement', async () => {
    const env = { ANTHROPIC_API_KEY: 'sk-ant-xxx' }
    expect((await detectClaude({ run: runner(CLAUDE_READY), env })).state).toBe('api_billing_risk')
    expect((await detectClaude({ run: runner(CLAUDE_READY), env, allowWithApiKey: true })).state).toBe('ready')
  })

  it('applies the same rule to Codex and OPENAI_API_KEY', async () => {
    const env = { OPENAI_API_KEY: 'sk-xxx' }
    const blocked = await detectCodex({ run: runner(CODEX_READY), env })
    expect(blocked.state).toBe('api_billing_risk')
    expect(blocked.detail).toContain('OPENAI_API_KEY detected.')
    expect((await detectCodex({ run: runner(CODEX_READY), env, allowWithApiKey: true })).state).toBe('ready')
  })

  it('never unsets the variable itself', async () => {
    const env = { ANTHROPIC_API_KEY: 'sk-ant-xxx' }
    await detectClaude({ run: runner(CLAUDE_READY), env })
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-xxx')
  })
})

describe('privacy confirmation', () => {
  it('refuses to initialize a subscription provider that was never acknowledged', async () => {
    const provider = new CodexCliProvider(providerSettings(), () => detectCodex({ run: runner(CODEX_READY), env: {} }))
    await expect(provider.initialize()).rejects.toMatchObject({ code: 'not_acknowledged' })
  })

  it('initializes once the provider is acknowledged', async () => {
    const settings = providerSettings({ privacyAcknowledged: ['codex-cli'] })
    const provider = new CodexCliProvider(settings, (options) =>
      detectCodex({ run: runner(CODEX_READY), env: {}, acknowledged: options.acknowledged })
    )
    await expect(provider.initialize()).resolves.toBeUndefined()
    expect(await provider.healthCheck()).toBe(true)
  })

  it('states the vendor, never "local", for subscription providers', () => {
    expect(PROVIDER_PRIVACY['codex-cli']).toBe(
      'Relevant documentation selected by retrieval will be sent to OpenAI through Codex.'
    )
    expect(PROVIDER_PRIVACY['claude-code-cli']).toBe(
      'Relevant documentation selected by retrieval will be sent to Anthropic through Claude Code.'
    )
    for (const id of ['codex-cli', 'claude-code-cli'] as ProviderId[]) {
      expect(PROVIDER_PRIVACY[id].toLowerCase()).not.toContain('runs entirely on this computer')
    }
    expect(PROVIDER_PRIVACY['local-gguf']).toContain('Runs entirely on this computer')
  })
})

describe('provider initialization errors', () => {
  it('maps a missing Claude CLI to not_installed and never to an API fallback', async () => {
    const provider = new ClaudeCodeCliProvider(
      providerSettings({ privacyAcknowledged: ['claude-code-cli'] }),
      () => detectClaude({ run: runner({}), env: {} })
    )
    await expect(provider.initialize()).rejects.toMatchObject({ code: 'not_installed' })
  })

  it('maps a detected API key to api_billing_risk', async () => {
    const provider = new ClaudeCodeCliProvider(
      providerSettings({ privacyAcknowledged: ['claude-code-cli'] }),
      () => detectClaude({ run: runner(CLAUDE_READY), env: { ANTHROPIC_API_KEY: 'sk-ant' } })
    )
    await expect(provider.initialize()).rejects.toMatchObject({ code: 'api_billing_risk' })
  })
})

describe('subscription limits', () => {
  it('recognises usage limits in CLI output', () => {
    expect(classifyCliFailure('Error: usage limit reached for your plan')).toBe('usage_limit')
    expect(classifyCliFailure('HTTP 429 Too Many Requests')).toBe('usage_limit')
    expect(classifyCliFailure('quota exceeded')).toBe('usage_limit')
    expect(classifyCliFailure('Please run login first')).toBe('auth')
    expect(classifyCliFailure('segmentation fault')).toBeNull()
  })

  it('points at the local models instead of retrying', () => {
    expect(codexFailureMessage('usage limit reached', 1)).toBe(
      'Codex usage limit reached. Your DocMind local models are still available.'
    )
    expect(claudeFailureMessage('rate limit exceeded', 1)).toBe(
      'Claude usage limit reached. Your DocMind local models are still available.'
    )
  })

  it('keeps an unknown failure recognisable instead of guessing', () => {
    expect(codexFailureMessage('spawn ENOENT', 127)).toContain('exited with code 127')
  })
})

describe('provider selection', () => {
  it('builds the provider named by the settings', async () => {
    const codex = new ModelManager({ ...DEFAULT_SETTINGS.model, provider: 'codex-cli' }, DEFAULT_SETTINGS.providers)
    expect(codex.status().provider).toBe('codex-cli')
    expect(codex.status().model).toBe('Codex')

    const claude = new ModelManager(
      { ...DEFAULT_SETTINGS.model, provider: 'claude-code-cli' },
      DEFAULT_SETTINGS.providers
    )
    expect(claude.status().model).toBe('Claude Code')
  })

  it('still refuses to generate when no provider is configured', async () => {
    const manager = new ModelManager(DEFAULT_SETTINGS.model)
    await expect(manager.ensureReady()).rejects.toBeInstanceOf(LLMError)
  })

  it('unloads when the provider settings alone change', async () => {
    const manager = new ModelManager({ ...DEFAULT_SETTINGS.model, provider: 'ollama', ollamaModel: 'stub' })
    let unloaded = false
    const stub = {
      initialize: async () => undefined,
      healthCheck: async () => true,
      unload: async () => {
        unloaded = true
      },
      describe: () => ({ provider: 'ollama' as const, model: 'stub', contextSize: 1, detail: 'stub' }),
      generate: async function* () {
        yield { type: 'start', provider: 'ollama', model: 'stub' } as GenerationEvent
      }
    }
    Object.assign(manager as unknown as { build: () => unknown }, { build: () => stub })

    await manager.ensureReady()
    await manager.applySettings(
      { ...DEFAULT_SETTINGS.model, provider: 'ollama', ollamaModel: 'stub' },
      { ...DEFAULT_SETTINGS.providers, claudeModel: 'opus' }
    )
    expect(unloaded).toBe(true)
    expect(manager.status().state).toBe('unloaded')
  })

  it('surfaces a subscription failure instead of falling back to another provider', async () => {
    const manager = new ModelManager(
      { ...DEFAULT_SETTINGS.model, provider: 'claude-code-cli' },
      DEFAULT_SETTINGS.providers
    )
    await expect(manager.ensureReady()).rejects.toBeInstanceOf(LLMError)
    // No silent switch: the manager stays in error, it does not become ready
    // on some other provider.
    expect(manager.status().state).toBe('error')
    expect(manager.status().provider).toBe('claude-code-cli')
  })

  it('classifies every provider as local or subscription, with no third option', () => {
    expect(PROVIDER_KIND['local-gguf']).toBe('local')
    expect(PROVIDER_KIND.ollama).toBe('ollama')
    expect(PROVIDER_KIND['codex-cli']).toBe('subscription')
    expect(PROVIDER_KIND['claude-code-cli']).toBe('subscription')
  })
})

describe('settings persistence', () => {
  it('round-trips the provider manager settings', () => {
    const db = memoryDb()
    const saved = saveSettings(db, {
      model: { provider: 'local-gguf', modelPath: '/models/docmind/model.gguf', managedModelId: 'docmind-lite-0.5b-q4' },
      providers: {
        registryUrl: 'https://example.com/manifest.json',
        customModelPaths: ['/home/me/mine.gguf'],
        privacyAcknowledged: ['codex-cli'],
        allowClaudeWithApiKey: true,
        claudeModel: 'sonnet'
      }
    })

    expect(saved.model.managedModelId).toBe('docmind-lite-0.5b-q4')
    const reloaded = loadSettings(db)
    expect(reloaded.providers.registryUrl).toBe('https://example.com/manifest.json')
    expect(reloaded.providers.customModelPaths).toEqual(['/home/me/mine.gguf'])
    expect(reloaded.providers.privacyAcknowledged).toEqual(['codex-cli'])
    expect(reloaded.providers.allowClaudeWithApiKey).toBe(true)
    expect(reloaded.providers.claudeModel).toBe('sonnet')
    db.close()
  })

  it('has no field that could hold a credential', () => {
    // The two allow* flags are booleans about billing risk, not key storage.
    expect(typeof DEFAULT_SETTINGS.providers.allowCodexWithApiKey).toBe('boolean')
    expect(typeof DEFAULT_SETTINGS.providers.allowClaudeWithApiKey).toBe('boolean')

    const valueKeys = Object.keys(DEFAULT_SETTINGS.providers).filter((key) => !key.startsWith('allow'))
    for (const forbidden of ['apikey', 'token', 'cookie', 'credential', 'secret', 'password', 'oauth', 'auth']) {
      expect(valueKeys.some((key) => key.toLowerCase().includes(forbidden))).toBe(false)
    }
  })

  it('keeps defaults when the stored settings predate the providers section', () => {
    const db = memoryDb()
    saveSettings(db, { model: { provider: 'ollama', ollamaModel: 'qwen2.5:3b' } })
    const reloaded = loadSettings(db)
    expect(reloaded.providers.privacyAcknowledged).toEqual([])
    expect(reloaded.providers.registryUrl).toBe('')
    db.close()
  })
})

describe('generation contract', () => {
  it('yields an error event, not a fallback answer, when the CLI is unavailable', async () => {
    const provider = new ClaudeCodeCliProvider(
      providerSettings({ privacyAcknowledged: ['claude-code-cli'] }),
      () => detectClaude({ run: runner({}), env: {} })
    )
    await expect(
      collect(provider.generate({ systemPrompt: 's', prompt: 'p', temperature: 0, maxTokens: 10 }))
    ).rejects.toBeInstanceOf(LLMError)
  })

  it('describes itself as a subscription provider', () => {
    const codex = new CodexCliProvider(providerSettings())
    expect(codex.describe().provider).toBe('codex-cli')
    const claude = new ClaudeCodeCliProvider(providerSettings({ claudeModel: 'sonnet' }))
    expect(claude.describe().model).toBe('sonnet')
  })
})

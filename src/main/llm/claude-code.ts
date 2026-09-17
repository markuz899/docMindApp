import os from 'node:os'
import { PROVIDER_PRIVACY, type ProviderHealth, type ProviderSettings } from '@shared/types'
import { classifyCliFailure, resolveBinary, runCommand, streamJsonLines, type CommandRunner } from './cli'
import {
  LLMError,
  type GenerateRequest,
  type GenerationEvent,
  type LLMProvider,
  type ProviderDescription
} from './types'

export const CLAUDE_BIN = 'claude'

export interface ClaudeDetectOptions {
  run?: CommandRunner
  env?: NodeJS.ProcessEnv
  acknowledged?: boolean
  allowWithApiKey?: boolean
}

const SETUP_HINT = 'Install Claude Code, then run `claude auth login` to sign in with your Claude account.'

interface AuthStatus {
  loggedIn?: boolean
  authMethod?: string
  apiKeySource?: string
  subscriptionType?: string | null
}

/**
 * Verified against Claude Code 2.1.274: `claude auth status --json` reports
 * whether an account is signed in and where the key, if any, comes from.
 * DocMind reads that summary only — never a credential file or a token.
 */
export async function detectClaude(options: ClaudeDetectOptions = {}): Promise<ProviderHealth> {
  const run = options.run ?? ((command, args) => runCommand(command, args))
  const env = options.env ?? process.env
  const base = {
    id: 'claude-code-cli' as const,
    kind: 'subscription' as const,
    label: 'Claude Code',
    privacy: PROVIDER_PRIVACY['claude-code-cli'],
    acknowledged: options.acknowledged ?? false
  }

  const binary = resolveBinary(CLAUDE_BIN, { ...env })
  const version = await run(binary, ['--version'])
  if (version.code !== 0) {
    return {
      ...base,
      state: 'not_installed',
      detail: 'Claude Code was not found on this machine.',
      version: null,
      setupHint: SETUP_HINT
    }
  }
  const versionLabel = version.stdout.trim().split('\n')[0] || null

  const status = await run(binary, ['auth', 'status', '--json'])
  let parsed: AuthStatus = {}
  try {
    parsed = JSON.parse(status.stdout) as AuthStatus
  } catch {
    parsed = {}
  }

  if (status.code !== 0 || parsed.loggedIn !== true) {
    return {
      ...base,
      state: 'not_authenticated',
      detail: 'Claude Code is installed but no Claude account is signed in.',
      version: versionLabel,
      setupHint: 'Run `claude auth login` and sign in with the account that carries your Claude plan.'
    }
  }

  // The whole point of this provider is to use the plan the user already pays
  // for. An API key in the environment would silently meter every answer, so
  // the provider stays disabled until the user says otherwise.
  const keyPresent = Boolean(env.ANTHROPIC_API_KEY) || parsed.apiKeySource === 'ANTHROPIC_API_KEY'
  if (keyPresent && !options.allowWithApiKey) {
    return {
      ...base,
      state: 'api_billing_risk',
      detail:
        'ANTHROPIC_API_KEY detected. Claude Code may use API billing instead of your Claude subscription. Remove the environment variable or explicitly acknowledge this configuration.',
      version: versionLabel,
      setupHint: 'Unset ANTHROPIC_API_KEY before starting DocMind, or acknowledge the configuration below.'
    }
  }

  return {
    ...base,
    state: 'ready',
    detail: `Signed in through Claude Code${parsed.authMethod ? ` (${parsed.authMethod})` : ''}.`,
    version: versionLabel,
    setupHint: null
  }
}

/**
 * Uses the locally installed, user-authenticated Claude Code CLI as a plain
 * prompt-to-answer LLM. No Anthropic API key, no API client, no fallback.
 *
 * Every tool is switched off and the session runs in a temporary directory, so
 * Claude Code cannot read the user's project or change anything.
 */
export class ClaudeCodeCliProvider implements LLMProvider {
  private binary = CLAUDE_BIN
  private ready = false

  constructor(
    private providers: ProviderSettings,
    private detect: (options: ClaudeDetectOptions) => Promise<ProviderHealth> = detectClaude
  ) {}

  describe(): ProviderDescription {
    return {
      provider: 'claude-code-cli',
      model: this.providers.claudeModel || 'Claude Code',
      contextSize: 0,
      detail: 'claude code cli · Claude subscription'
    }
  }

  async initialize(): Promise<void> {
    const health = await this.detect({
      acknowledged: this.providers.privacyAcknowledged.includes('claude-code-cli'),
      allowWithApiKey: this.providers.allowClaudeWithApiKey
    })
    if (health.state === 'not_installed') throw new LLMError(health.detail, 'not_installed')
    if (health.state === 'not_authenticated') throw new LLMError(health.detail, 'not_authenticated')
    if (health.state === 'api_billing_risk') throw new LLMError(health.detail, 'api_billing_risk')
    if (health.state !== 'ready') throw new LLMError(health.detail, 'unavailable')
    if (!health.acknowledged) {
      throw new LLMError(
        'Confirm on the AI Models page that retrieved documentation may be sent to Anthropic through Claude Code.',
        'not_acknowledged'
      )
    }
    this.binary = resolveBinary(CLAUDE_BIN)
    this.ready = true
  }

  async healthCheck(): Promise<boolean> {
    if (!this.ready) return false
    const health = await this.detect({
      acknowledged: true,
      allowWithApiKey: this.providers.allowClaudeWithApiKey
    })
    return health.state === 'ready'
  }

  async *generate(request: GenerateRequest): AsyncIterable<GenerationEvent> {
    if (!this.ready) await this.initialize()
    const model = this.providers.claudeModel || 'Claude Code'
    yield { type: 'start', provider: 'claude-code-cli', model }

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      // No tools, no MCP servers, no settings files: prompt in, answer out.
      '--restricted',
      '--strict-mcp-config',
      '--tools',
      '',
      '--system-prompt',
      request.systemPrompt
    ]
    if (this.providers.claudeModel) args.push('--model', this.providers.claudeModel)

    const startedAt = Date.now()
    let answer = ''
    let promptTokens = 0
    let generatedTokens = 0
    let rateLimited: string | null = null
    let resultError: string | null = null
    let exit: { code: number; stderr: string } = { code: 0, stderr: '' }

    const stream = streamJsonLines(
      {
        command: this.binary,
        args,
        input: request.prompt,
        cwd: os.tmpdir(),
        env: { ...process.env },
        signal: request.signal
      },
      (result) => {
        exit = result
      }
    )

    for await (const event of stream) {
      if (event.type === 'stream_event') {
        // Claude Code does emit real token deltas, so these are real tokens.
        const inner = event.event as
          | { type?: string; delta?: { type?: string; text?: string } }
          | undefined
        if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
          const token = inner.delta.text ?? ''
          if (token !== '') {
            answer += token
            yield { type: 'token', token }
          }
        }
      } else if (event.type === 'rate_limit_event') {
        const info = event.rate_limit_info as { status?: string } | undefined
        if (info?.status && info.status !== 'allowed') rateLimited = info.status
      } else if (event.type === 'result') {
        const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined
        promptTokens = usage?.input_tokens ?? 0
        generatedTokens = usage?.output_tokens ?? 0
        if (event.is_error === true) {
          resultError = typeof event.result === 'string' ? event.result : 'Claude Code reported an error.'
        }
        if (answer === '' && typeof event.result === 'string') answer = event.result
      }
    }

    if (request.signal?.aborted) return

    if (rateLimited !== null) {
      yield {
        type: 'error',
        message: 'Claude usage limit reached. Your DocMind local models are still available.'
      }
      return
    }

    if (resultError !== null || exit.code !== 0 || answer === '') {
      yield { type: 'error', message: claudeFailureMessage(`${resultError ?? ''}\n${exit.stderr}`, exit.code) }
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
        provider: 'claude-code-cli',
        model
      }
    }
  }

  async unload(): Promise<void> {
    this.ready = false
  }
}

export function claudeFailureMessage(text: string, code: number): string {
  const kind = classifyCliFailure(text)
  if (kind === 'usage_limit') {
    return 'Claude usage limit reached. Your DocMind local models are still available.'
  }
  if (kind === 'auth') {
    return 'Claude Code is not signed in any more. Run `claude auth login` and try again.'
  }
  const detail = text.trim().split('\n').filter(Boolean).slice(-3).join(' ').trim()
  return `Claude Code exited with code ${code}.${detail ? ` ${detail}` : ''}`
}

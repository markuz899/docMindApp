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

export const CODEX_BIN = 'codex'

export interface CodexDetectOptions {
  run?: CommandRunner
  env?: NodeJS.ProcessEnv
  acknowledged?: boolean
  allowWithApiKey?: boolean
}

const SETUP_HINT = 'Install the Codex CLI, then run `codex login` to sign in with your ChatGPT account.'

/**
 * Verified against codex-cli 0.154.0: `codex login status` exits non-zero when
 * the CLI is installed but nobody is signed in. No credential file is read.
 */
export async function detectCodex(options: CodexDetectOptions = {}): Promise<ProviderHealth> {
  const run = options.run ?? ((command, args) => runCommand(command, args))
  const env = options.env ?? process.env
  const base = {
    id: 'codex-cli' as const,
    kind: 'subscription' as const,
    label: 'Codex',
    privacy: PROVIDER_PRIVACY['codex-cli'],
    acknowledged: options.acknowledged ?? false
  }

  const binary = resolveBinary(CODEX_BIN, { ...env })
  const version = await run(binary, ['--version'])
  if (version.code !== 0) {
    return {
      ...base,
      state: 'not_installed',
      detail: 'Codex CLI was not found on this machine.',
      version: null,
      setupHint: SETUP_HINT
    }
  }
  const versionLabel = version.stdout.trim().split('\n')[0] || null

  const status = await run(binary, ['login', 'status'])
  const statusText = `${status.stdout}\n${status.stderr}`.trim()
  if (status.code !== 0) {
    return {
      ...base,
      state: 'not_authenticated',
      detail: statusText || 'Codex CLI is installed but not signed in.',
      version: versionLabel,
      setupHint: 'Run `codex login` and sign in with the ChatGPT account that carries your plan.'
    }
  }

  // DocMind never falls back to a metered API. If the CLI could bill an API
  // key instead of the plan, the provider stays off until that is acknowledged.
  if (env.OPENAI_API_KEY && !options.allowWithApiKey) {
    return {
      ...base,
      state: 'api_billing_risk',
      detail:
        'OPENAI_API_KEY detected. Codex may use API billing instead of your ChatGPT subscription. Remove the environment variable or explicitly acknowledge this configuration.',
      version: versionLabel,
      setupHint: 'Unset OPENAI_API_KEY before starting DocMind, or acknowledge the configuration below.'
    }
  }

  return {
    ...base,
    state: 'ready',
    detail: statusText || 'Signed in through the Codex CLI.',
    version: versionLabel,
    setupHint: null
  }
}

/**
 * Uses the locally installed, user-authenticated Codex CLI as a plain
 * prompt-to-answer LLM. No OpenAI API key, no API client, no fallback.
 *
 * Codex runs read-only, outside the user's project, in an ephemeral session:
 * the only thing it ever sees is the system prompt plus the context that
 * retrieval already selected.
 */
export class CodexCliProvider implements LLMProvider {
  private binary = CODEX_BIN
  private ready = false

  constructor(
    private providers: ProviderSettings,
    private detect: (options: CodexDetectOptions) => Promise<ProviderHealth> = detectCodex
  ) {}

  describe(): ProviderDescription {
    return {
      provider: 'codex-cli',
      model: this.providers.codexModel || 'Codex',
      contextSize: 0,
      detail: 'codex cli · ChatGPT subscription'
    }
  }

  async initialize(): Promise<void> {
    const health = await this.detect({
      acknowledged: this.providers.privacyAcknowledged.includes('codex-cli'),
      allowWithApiKey: this.providers.allowCodexWithApiKey
    })
    if (health.state === 'not_installed') throw new LLMError(health.detail, 'not_installed')
    if (health.state === 'not_authenticated') throw new LLMError(health.detail, 'not_authenticated')
    if (health.state === 'api_billing_risk') throw new LLMError(health.detail, 'api_billing_risk')
    if (health.state !== 'ready') throw new LLMError(health.detail, 'unavailable')
    if (!health.acknowledged) {
      throw new LLMError(
        'Confirm on the AI Models page that retrieved documentation may be sent to OpenAI through Codex.',
        'not_acknowledged'
      )
    }
    this.binary = resolveBinary(CODEX_BIN)
    this.ready = true
  }

  async healthCheck(): Promise<boolean> {
    if (!this.ready) return false
    const health = await this.detect({
      acknowledged: true,
      allowWithApiKey: this.providers.allowCodexWithApiKey
    })
    return health.state === 'ready'
  }

  async *generate(request: GenerateRequest): AsyncIterable<GenerationEvent> {
    if (!this.ready) await this.initialize()
    const model = this.providers.codexModel || 'Codex'
    yield { type: 'start', provider: 'codex-cli', model }

    const args = [
      'exec',
      '--json',
      // Read-only sandbox, no project directory, no persisted session: Codex is
      // an answer engine here, never an agent that touches the user's files.
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--cd',
      os.tmpdir()
    ]
    if (this.providers.codexModel) args.push('--model', this.providers.codexModel)
    args.push('-')

    const startedAt = Date.now()
    let answer = ''
    let outputTokens = 0
    let promptTokens = 0
    let exit: { code: number; stderr: string } = { code: 0, stderr: '' }

    const stream = streamJsonLines(
      {
        command: this.binary,
        args,
        input: `${request.systemPrompt}\n\n${request.prompt}`,
        cwd: os.tmpdir(),
        env: { ...process.env },
        signal: request.signal
      },
      (result) => {
        exit = result
      }
    )

    for await (const event of stream) {
      if (event.type === 'item.completed') {
        const item = event.item as { type?: string; text?: string } | undefined
        // codex-cli 0.154.0 emits the assistant message once, complete. There
        // is no token delta event, so nothing here pretends to stream.
        if (item?.type === 'agent_message' && typeof item.text === 'string') {
          answer += item.text
          yield { type: 'token', token: item.text }
        }
      } else if (event.type === 'turn.failed') {
        const error = event.error as { message?: string } | undefined
        yield { type: 'error', message: error?.message ?? 'Codex reported a failed turn.' }
        return
      } else if (event.type === 'turn.completed') {
        const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined
        promptTokens = usage?.input_tokens ?? 0
        outputTokens = usage?.output_tokens ?? 0
      }
    }

    if (request.signal?.aborted) return

    if (exit.code !== 0 || answer === '') {
      yield { type: 'error', message: codexFailureMessage(exit.stderr, exit.code) }
      return
    }

    const generationMs = Date.now() - startedAt
    yield {
      type: 'done',
      stats: {
        promptTokens,
        generatedTokens: outputTokens,
        tokensPerSecond: generationMs > 0 ? (outputTokens / generationMs) * 1000 : 0,
        generationMs,
        provider: 'codex-cli',
        model
      }
    }
  }

  async unload(): Promise<void> {
    this.ready = false
  }
}

/** Plan limits are the expected failure here, so they get their own wording. */
export function codexFailureMessage(stderr: string, code: number): string {
  const kind = classifyCliFailure(stderr)
  if (kind === 'usage_limit') {
    return 'Codex usage limit reached. Your DocMind local models are still available.'
  }
  if (kind === 'auth') {
    return 'Codex is not signed in any more. Run `codex login` and try again.'
  }
  const detail = stderr.trim().split('\n').slice(-3).join(' ').trim()
  return `Codex CLI exited with code ${code}.${detail ? ` ${detail}` : ''}`
}

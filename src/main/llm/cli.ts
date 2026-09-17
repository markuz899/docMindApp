import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>

/**
 * A GUI Electron build does not inherit the login shell's PATH, so the usual
 * install locations are probed before falling back to a bare PATH lookup.
 */
export function resolveBinary(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', name),
    path.join(os.homedir(), '.bun', 'bin', name),
    '/opt/homebrew/bin/' + name,
    '/usr/local/bin/' + name,
    path.join(os.homedir(), '.npm-global', 'bin', name)
  ]
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  const extra = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  env.PATH = [...new Set([...(env.PATH ?? '').split(path.delimiter), ...extra])].filter(Boolean).join(path.delimiter)
  return name
}

/** Short, non-interactive command used for detection and health checks. */
export function runCommand(command: string, args: string[], timeoutMs = 10_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: process.env.PATH }
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      resolve({ code: 127, stdout, stderr: error.message })
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export interface CliStreamOptions {
  command: string
  args: string[]
  /** The prompt is written to stdin instead of argv: contexts are large. */
  input: string
  cwd: string
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
}

export interface CliStreamResult {
  code: number
  stderr: string
}

/**
 * Spawns a CLI that prints JSONL on stdout and yields one parsed object per
 * line. Lines that are not JSON are ignored: CLIs print human notices too.
 */
export async function* streamJsonLines(
  options: CliStreamOptions,
  onExit: (result: CliStreamResult) => void
): AsyncGenerator<Record<string, unknown>> {
  const child = spawn(options.command, options.args, {
    shell: false,
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  const abort = (): void => {
    child.kill('SIGTERM')
  }
  options.signal?.addEventListener('abort', abort, { once: true })

  child.stdin.on('error', () => undefined)
  child.stdin.end(options.input)

  const exited = new Promise<number>((resolve) => {
    child.on('error', () => resolve(127))
    child.on('close', (code: number | null) => resolve(code ?? 1))
  })

  let buffer = ''
  try {
    for await (const chunk of child.stdout) {
      buffer += (chunk as Buffer).toString()
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (line === '' || !line.startsWith('{')) continue
        try {
          yield JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }
      }
    }
    const tail = buffer.trim()
    if (tail.startsWith('{')) {
      try {
        yield JSON.parse(tail) as Record<string, unknown>
      } catch {
        /* a truncated final line carries no usable event */
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', abort)
    onExit({ code: await exited, stderr })
  }
}

const USAGE_LIMIT = /(usage limit|rate limit|rate_limit|quota|too many requests|429|limit reached|out of credit)/i
const AUTH_FAILURE = /(not logged in|unauthenticated|unauthorized|please (run )?login|401|sign in|authentication)/i

/** Turns CLI noise into the one distinction the UI has to make. */
export function classifyCliFailure(text: string): 'usage_limit' | 'auth' | null {
  if (USAGE_LIMIT.test(text)) return 'usage_limit'
  if (AUTH_FAILURE.test(text)) return 'auth'
  return null
}

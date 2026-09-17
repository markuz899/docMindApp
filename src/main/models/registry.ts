import fs from 'node:fs'
import path from 'node:path'
import { modelManifestSchema, type ModelManifest, type RegistryState } from '@shared/types'

export interface RegistryOptions {
  /** Explicit URL from Settings; falls back to the environment variable. */
  url: string
  cacheFile: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export const REGISTRY_ENV_VAR = 'DOCMIND_MODEL_REGISTRY_URL'

/**
 * Settings win, then the environment. There is deliberately no built-in
 * default: shipping a placeholder URL would mean shipping a broken download
 * button. See docs/MODEL_PUBLISHING.md for pointing this at the real registry.
 */
export function resolveRegistryUrl(configured: string, env: NodeJS.ProcessEnv = process.env): string {
  return configured.trim() || (env[REGISTRY_ENV_VAR] ?? '').trim()
}

interface CacheFile {
  url: string
  fetchedAt: number
  manifest: unknown
}

function readCache(cacheFile: string): { url: string; fetchedAt: number; manifest: ModelManifest } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as CacheFile
    return { url: raw.url, fetchedAt: raw.fetchedAt, manifest: modelManifestSchema.parse(raw.manifest) }
  } catch {
    return null
  }
}

function writeCache(cacheFile: string, payload: CacheFile): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2))
  } catch {
    // A catalog that cannot be cached is still usable this session.
  }
}

async function fetchManifest(url: string, options: RegistryOptions): Promise<ModelManifest> {
  const doFetch = options.fetchImpl ?? fetch
  // file:// is allowed so a local fixture can be used during development;
  // anything reachable over the network must be https.
  if (url.startsWith('file://') || path.isAbsolute(url)) {
    const file = url.startsWith('file://') ? new URL(url).pathname : url
    return modelManifestSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
  }
  if (!url.startsWith('https://')) {
    throw new Error(`the model registry URL must use https (got "${url}")`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)
  try {
    const response = await doFetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return modelManifestSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Never throws: offline is a normal state for DocMind, and a failed catalog
 * refresh must not hide the models that are already installed.
 */
export async function loadRegistry(options: RegistryOptions): Promise<RegistryState> {
  const url = options.url.trim()
  const cached = readCache(options.cacheFile)

  if (url === '') {
    if (cached) {
      return { source: 'cache', url: cached.url, fetchedAt: cached.fetchedAt, models: cached.manifest.models, error: null }
    }
    return {
      source: 'none',
      url: null,
      fetchedAt: null,
      models: [],
      error: `No model registry configured. Set ${REGISTRY_ENV_VAR} or the registry URL in Settings.`
    }
  }

  try {
    const manifest = await fetchManifest(url, options)
    const fetchedAt = Date.now()
    writeCache(options.cacheFile, { url, fetchedAt, manifest })
    return { source: 'remote', url, fetchedAt, models: manifest.models, error: null }
  } catch (error) {
    const message = (error as Error).message
    if (cached) {
      return { source: 'cache', url: cached.url, fetchedAt: cached.fetchedAt, models: cached.manifest.models, error: message }
    }
    return { source: 'none', url, fetchedAt: null, models: [], error: message }
  }
}

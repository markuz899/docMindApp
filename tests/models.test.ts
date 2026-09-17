import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadModel, DownloadError } from '@main/models/download'
import { detectHardware, modelFit } from '@main/models/hardware'
import { loadRegistry, resolveRegistryUrl, REGISTRY_ENV_VAR, DEFAULT_REGISTRY_URL } from '@main/models/registry'
import {
  deleteInstalled,
  findInstalled,
  isManagedPath,
  isSafeModelId,
  listInstalled,
  metadataFor,
  modelFilePath,
  writeMetadata
} from '@main/models/store'
import { modelManifestSchema, type DownloadProgress, type RegistryModel } from '@shared/types'

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures', 'model-registry.json')

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmind-models-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function fixtureManifest(): { models: RegistryModel[] } {
  return modelManifestSchema.parse(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')))
}

function fixtureModel(index = 0): RegistryModel {
  const model = fixtureManifest().models[index]
  if (!model) throw new Error(`fixture has no model at index ${index}`)
  return model
}

/** A fetch stand-in that streams `body` and reports a content-length. */
function fakeFetch(body: Buffer, init: { status?: number; headers?: Record<string, string> } = {}): typeof fetch {
  return (async () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: { 'content-length': String(body.byteLength), ...(init.headers ?? {}) }
    })) as unknown as typeof fetch
}

function modelFor(body: Buffer, overrides: Partial<RegistryModel> = {}): RegistryModel {
  const base = fixtureModel()
  return {
    ...base,
    sizeBytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
    ...overrides
  }
}

/* ------------------------------------------------------------------ */

describe('manifest parsing', () => {
  it('accepts the shipped fixture', () => {
    expect(fixtureManifest().models).toHaveLength(2)
    expect(fixtureModel().id).toBe('docmind-lite-0.5b-q4')
    expect(fixtureModel().contextSize).toBe(4096)
  })

  it('defaults optional benchmarks to null instead of inventing numbers', () => {
    expect(fixtureModel().benchmarks).toEqual({
      citationF1: null,
      hallucinationRate: null,
      usefulAnswerRate: null
    })
    expect(fixtureModel(1).benchmarks).toBeNull()
  })

  it('rejects a model without a valid sha256', () => {
    const payload = { version: 1, models: [{ ...fixtureModel(), sha256: 'nope' }] }
    expect(() => modelManifestSchema.parse(payload)).toThrow(/sha256/)
  })

  it('rejects a non-https download url', () => {
    const payload = { version: 1, models: [{ ...fixtureModel(), url: 'http://example.com/m.gguf' }] }
    expect(() => modelManifestSchema.parse(payload)).toThrow(/https/)
  })

  it('rejects an unknown manifest version', () => {
    expect(() => modelManifestSchema.parse({ version: 2, models: [] })).toThrow()
  })
})

describe('registry url resolution', () => {
  it('prefers the configured url over the environment', () => {
    expect(resolveRegistryUrl('https://a/manifest.json', { [REGISTRY_ENV_VAR]: 'https://b' })).toBe(
      'https://a/manifest.json'
    )
  })

  it('falls back to the environment variable', () => {
    expect(resolveRegistryUrl('  ', { [REGISTRY_ENV_VAR]: 'https://b/manifest.json' })).toBe('https://b/manifest.json')
  })

  it('falls back to the official catalog when nothing is configured', () => {
    expect(resolveRegistryUrl('', {})).toBe(DEFAULT_REGISTRY_URL)
  })

  it('ships a real https catalog url, not a placeholder', () => {
    expect(DEFAULT_REGISTRY_URL).toMatch(/^https:\/\//)
    expect(DEFAULT_REGISTRY_URL).not.toMatch(/example\.(com|org)|changeme|TODO|your-/i)
  })
})

describe('registry cache and offline behaviour', () => {
  const cacheFile = (): string => path.join(tmp, 'registry-cache.json')

  it('loads a local fixture file and writes a cache', async () => {
    const state = await loadRegistry({ url: FIXTURE, cacheFile: cacheFile() })
    expect(state.source).toBe('remote')
    expect(state.models).toHaveLength(2)
    expect(fs.existsSync(cacheFile())).toBe(true)
  })

  it('serves the cached manifest when the network fails', async () => {
    await loadRegistry({ url: FIXTURE, cacheFile: cacheFile() })
    const offline = await loadRegistry({
      url: 'https://example.invalid/manifest.json',
      cacheFile: cacheFile(),
      fetchImpl: (async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      }) as unknown as typeof fetch
    })
    expect(offline.source).toBe('cache')
    expect(offline.models).toHaveLength(2)
    expect(offline.error).toMatch(/ENOTFOUND/)
  })

  it('reports an empty catalog rather than throwing when nothing is configured', async () => {
    const state = await loadRegistry({ url: '', cacheFile: path.join(tmp, 'missing.json') })
    expect(state.source).toBe('none')
    expect(state.models).toEqual([])
    expect(state.error).toContain(REGISTRY_ENV_VAR)
  })

  it('refuses a plain http registry url', async () => {
    const state = await loadRegistry({ url: 'http://example.com/manifest.json', cacheFile: cacheFile() })
    expect(state.source).toBe('none')
    expect(state.error).toMatch(/https/)
  })
})

describe('hardware detection', () => {
  it('reports what the OS actually says', () => {
    const hardware = detectHardware()
    expect(hardware.platform).toBe(os.platform())
    expect(hardware.arch).toBe(os.arch())
    expect(hardware.totalMemoryBytes).toBe(os.totalmem())
    expect(hardware.totalMemoryGb).toBeGreaterThan(0)
    expect(hardware.cpuCount).toBe(os.cpus().length)
  })

  it('flags Apple Silicon only on darwin/arm64', () => {
    const hardware = detectHardware()
    expect(hardware.appleSilicon).toBe(os.platform() === 'darwin' && os.arch() === 'arm64')
  })

  it('classifies a model against the detected memory', () => {
    const lite = fixtureModel()
    const balanced = fixtureModel(1)
    const eightGb = { ...detectHardware(), totalMemoryGb: 8 }
    expect(modelFit(lite, eightGb)).toBe('recommended')
    expect(modelFit(balanced, eightGb)).toBe('compatible')
    expect(modelFit(balanced, { ...eightGb, totalMemoryGb: 4 })).toBe('too_large')
  })
})

describe('model store', () => {
  it('rejects model ids that could escape the store directory', () => {
    expect(isSafeModelId('docmind-lite-0.5b-q4')).toBe(true)
    expect(isSafeModelId('../etc')).toBe(false)
    expect(isSafeModelId('/absolute')).toBe(false)
    expect(isSafeModelId('')).toBe(false)
  })

  it('ignores a directory whose weights are missing', () => {
    const model = fixtureModel()
    writeMetadata(tmp, metadataFor(model, model.sha256, model.sizeBytes))
    expect(listInstalled(tmp)).toHaveLength(0)

    fs.writeFileSync(modelFilePath(tmp, model.id), 'weights')
    expect(listInstalled(tmp)).toHaveLength(1)
  })

  it('marks a newer catalog version as an update instead of replacing it', () => {
    const model = fixtureModel()
    writeMetadata(tmp, { ...metadataFor(model, model.sha256, 10), version: '1.0' })
    fs.writeFileSync(modelFilePath(tmp, model.id), 'weights')

    const installed = listInstalled(tmp, [model])
    expect(installed).toHaveLength(1)
    expect(installed[0]).toMatchObject({ version: '1.0', updateAvailable: true, latestVersion: '2.0' })
  })

  it('deletes only managed models', () => {
    const model = fixtureModel()
    writeMetadata(tmp, metadataFor(model, model.sha256, 10))
    fs.writeFileSync(modelFilePath(tmp, model.id), 'weights')
    expect(findInstalled(tmp, model.id)).not.toBeNull()

    deleteInstalled(tmp, model.id)
    expect(findInstalled(tmp, model.id)).toBeNull()
    expect(() => deleteInstalled(tmp, model.id)).toThrow(/not a DocMind-managed model/)
  })

  it('refuses to delete a directory that is not a managed model', () => {
    fs.mkdirSync(path.join(tmp, 'stray'))
    fs.writeFileSync(path.join(tmp, 'stray', 'important.gguf'), 'user file')
    expect(() => deleteInstalled(tmp, 'stray')).toThrow(/not a DocMind-managed model/)
    expect(fs.existsSync(path.join(tmp, 'stray', 'important.gguf'))).toBe(true)
  })

  it('knows a custom path outside the store is not managed', () => {
    expect(isManagedPath(tmp, path.join(tmp, 'docmind-lite', 'model.gguf'))).toBe(true)
    expect(isManagedPath(tmp, path.join(os.homedir(), 'models', 'mine.gguf'))).toBe(false)
  })
})

describe('model download', () => {
  const collect = (): { events: DownloadProgress[]; onProgress: (p: DownloadProgress) => void } => {
    const events: DownloadProgress[] = []
    return { events, onProgress: (progress) => events.push(progress) }
  }

  it('downloads, verifies and installs a model', async () => {
    const body = Buffer.from('a'.repeat(4096))
    const model = modelFor(body)
    const { events, onProgress } = collect()

    const installed = await downloadModel({ model, modelsDir: tmp, onProgress, fetchImpl: fakeFetch(body) })

    expect(installed.filePath).toBe(modelFilePath(tmp, model.id))
    expect(fs.readFileSync(installed.filePath)).toEqual(body)
    expect(installed.sha256).toBe(model.sha256)
    expect(events.map((e) => e.phase)).toContain('verifying')
    expect(events.at(-1)?.phase).toBe('done')
    expect(findInstalled(tmp, model.id)?.id).toBe(model.id)
  })

  it('reports real byte counts and a percentage', async () => {
    const body = Buffer.from('b'.repeat(2048))
    const model = modelFor(body)
    const { events, onProgress } = collect()

    await downloadModel({ model, modelsDir: tmp, onProgress, fetchImpl: fakeFetch(body) })

    const verifying = events.find((e) => e.phase === 'verifying')
    expect(verifying?.receivedBytes).toBe(2048)
    expect(verifying?.totalBytes).toBe(2048)
    expect(verifying?.percent).toBe(1)
  })

  it('deletes the file and refuses to install on a checksum mismatch', async () => {
    const body = Buffer.from('tampered payload')
    const model = modelFor(body, { sha256: 'f'.repeat(64) })
    const { events, onProgress } = collect()

    await expect(
      downloadModel({ model, modelsDir: tmp, onProgress, fetchImpl: fakeFetch(body) })
    ).rejects.toMatchObject({ code: 'checksum' })

    expect(fs.existsSync(modelFilePath(tmp, model.id))).toBe(false)
    expect(findInstalled(tmp, model.id)).toBeNull()
    expect(events.at(-1)?.phase).toBe('error')
  })

  it('leaves no .part file behind when a download fails', async () => {
    const body = Buffer.from('payload')
    const model = modelFor(body, { sha256: 'e'.repeat(64) })

    await expect(
      downloadModel({ model, modelsDir: tmp, onProgress: () => undefined, fetchImpl: fakeFetch(body) })
    ).rejects.toBeInstanceOf(DownloadError)

    expect(fs.existsSync(`${modelFilePath(tmp, model.id)}.part`)).toBe(false)
    expect(fs.existsSync(path.join(tmp, model.id))).toBe(false)
  })

  it('cleans up a stale .part file from an earlier attempt', async () => {
    const body = Buffer.from('c'.repeat(512))
    const model = modelFor(body)
    fs.mkdirSync(path.join(tmp, model.id), { recursive: true })
    fs.writeFileSync(`${modelFilePath(tmp, model.id)}.part`, 'stale bytes')

    const installed = await downloadModel({
      model,
      modelsDir: tmp,
      onProgress: () => undefined,
      fetchImpl: fakeFetch(body)
    })

    expect(fs.readFileSync(installed.filePath)).toEqual(body)
    expect(fs.existsSync(`${installed.filePath}.part`)).toBe(false)
  })

  it('stops on cancellation without installing anything', async () => {
    const body = Buffer.from('d'.repeat(1024))
    const model = modelFor(body)
    const controller = new AbortController()
    controller.abort()

    await expect(
      downloadModel({
        model,
        modelsDir: tmp,
        onProgress: () => undefined,
        signal: controller.signal,
        fetchImpl: fakeFetch(body)
      })
    ).rejects.toMatchObject({ code: 'cancelled' })

    expect(findInstalled(tmp, model.id)).toBeNull()
  })

  it('refuses a redirect that leaves https', async () => {
    const model = modelFor(Buffer.from('x'))
    const redirecting = (async (url: string) => {
      if (url.startsWith('https://')) {
        return new Response(null, { status: 302, headers: { location: 'http://evil.example/model.gguf' } })
      }
      return new Response(Buffer.from('x'))
    }) as unknown as typeof fetch

    await expect(
      downloadModel({ model, modelsDir: tmp, onProgress: () => undefined, fetchImpl: redirecting })
    ).rejects.toMatchObject({ code: 'insecure' })
  })

  it('follows an https redirect', async () => {
    const body = Buffer.from('redirected weights')
    const model = modelFor(body)
    const redirecting = (async (url: string) => {
      if (url === model.url) {
        return new Response(null, { status: 302, headers: { location: 'https://cdn.example/model.gguf' } })
      }
      return new Response(body, { headers: { 'content-length': String(body.byteLength) } })
    }) as unknown as typeof fetch

    const installed = await downloadModel({
      model,
      modelsDir: tmp,
      onProgress: () => undefined,
      fetchImpl: redirecting
    })
    expect(fs.readFileSync(installed.filePath)).toEqual(body)
  })

  it('surfaces an HTTP error instead of installing an error page', async () => {
    const model = modelFor(Buffer.from('y'))
    const failing = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch

    await expect(
      downloadModel({ model, modelsDir: tmp, onProgress: () => undefined, fetchImpl: failing })
    ).rejects.toMatchObject({ code: 'http' })
    expect(findInstalled(tmp, model.id)).toBeNull()
  })
})

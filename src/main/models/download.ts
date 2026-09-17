import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { DownloadProgress, ManagedModel, RegistryModel } from '@shared/types'
import { METADATA_FILENAME, MODEL_FILENAME, metadataFor, modelDirectory, writeMetadata } from './store'

export interface DownloadOptions {
  model: RegistryModel
  modelsDir: string
  onProgress: (progress: DownloadProgress) => void
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  maxRedirects?: number
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly code: 'http' | 'cancelled' | 'checksum' | 'insecure' | 'io'
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

/**
 * Follows redirects by hand so every hop can be checked: a catalog entry that
 * starts on https must not be able to bounce the download onto plain http.
 */
async function openStream(url: string, options: DownloadOptions): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch
  const maxRedirects = options.maxRedirects ?? 5
  let current = url

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!current.startsWith('https://')) {
      throw new DownloadError(`Refusing a non-https download URL: ${current}`, 'insecure')
    }
    const response = await doFetch(current, { redirect: 'manual', signal: options.signal ?? null })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new DownloadError(`HTTP ${response.status} without a Location header`, 'http')
      current = new URL(location, current).toString()
      continue
    }
    if (!response.ok) throw new DownloadError(`HTTP ${response.status} while downloading ${current}`, 'http')
    if (!response.body) throw new DownloadError('The download response had no body.', 'http')
    return response
  }
  throw new DownloadError(`Too many redirects while downloading ${url}`, 'http')
}

/**
 * Downloads one catalog model into `<modelsDir>/<id>/`.
 *
 * The bytes land in `model.gguf.part` and are only renamed into place after the
 * SHA256 matches the manifest, so an interrupted or corrupted download can
 * never be picked up as an installed model.
 *
 * ponytail: no HTTP Range resume — a cancelled download restarts from zero.
 * The `.part` file and the hop-by-hop loop are where `Range` + a saved offset
 * would go if partial downloads become worth it.
 */
export async function downloadModel(options: DownloadOptions): Promise<ManagedModel> {
  const { model, modelsDir, onProgress } = options
  const dir = modelDirectory(modelsDir, model.id)
  const target = path.join(dir, MODEL_FILENAME)
  const partial = `${target}.part`

  fs.mkdirSync(dir, { recursive: true })
  // No resume yet, so a leftover part file is always stale.
  fs.rmSync(partial, { force: true })

  const startedAt = Date.now()
  let received = 0
  let total = model.sizeBytes
  let lastEmit = 0
  let lastBytes = 0
  let lastTime = startedAt

  const emit = (phase: DownloadProgress['phase'], message: string | null = null, force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < 200) return
    const windowMs = now - lastTime
    const bytesPerSecond = windowMs > 0 ? ((received - lastBytes) / windowMs) * 1000 : 0
    if (windowMs >= 400) {
      lastBytes = received
      lastTime = now
    }
    lastEmit = now
    onProgress({
      modelId: model.id,
      phase,
      receivedBytes: received,
      totalBytes: total,
      percent: total > 0 ? Math.min(1, received / total) : 0,
      bytesPerSecond,
      message
    })
  }

  const hash = createHash('sha256')
  // Opened only once the response is in hand: a stream created earlier would
  // still be opening the file while the error path is already deleting it.
  let sink: fs.WriteStream | null = null
  const abort = (): never => {
    throw new DownloadError('Download cancelled.', 'cancelled')
  }

  try {
    const response = await openStream(model.url, options)
    const declared = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > 0) total = declared

    sink = fs.createWriteStream(partial)
    // The cleanup path may pull the file out from under a pending write.
    sink.on('error', () => undefined)
    await new Promise<void>((resolve, reject) => {
      sink!.once('open', () => resolve())
      sink!.once('error', reject)
    })

    emit('downloading', null, true)
    const reader = response.body!.getReader()
    for (;;) {
      if (options.signal?.aborted) abort()
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const chunk = Buffer.from(value)
      hash.update(chunk)
      received += chunk.byteLength
      if (!sink.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          sink!.once('drain', resolve)
          sink!.once('error', reject)
        })
      }
      emit('downloading')
    }

    // Wait for 'close', not just 'finish': Windows refuses to rename or delete
    // a file whose descriptor is still open, so an early rename would fail with
    // EPERM on every download.
    await new Promise<void>((resolve, reject) => {
      sink!.once('close', () => resolve())
      sink!.once('error', reject)
      sink!.end()
    })

    emit('verifying', 'Verifying SHA256…', true)
    const digest = hash.digest('hex')
    if (digest.toLowerCase() !== model.sha256.toLowerCase()) {
      fs.rmSync(partial, { force: true })
      throw new DownloadError(
        `Checksum mismatch for ${model.name}. Expected ${model.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…. The file was deleted and the model was not installed.`,
        'checksum'
      )
    }

    emit('installing', 'Installing…', true)
    fs.renameSync(partial, target)
    const stat = fs.statSync(target)
    writeMetadata(modelsDir, metadataFor(model, digest, stat.size))
    emit('done', 'Ready', true)

    return {
      ...metadataFor(model, digest, stat.size),
      filePath: target,
      updateAvailable: false,
      latestVersion: model.version
    }
  } catch (error) {
    await closeQuietly(sink)
    fs.rmSync(partial, { force: true })
    // A model directory that never held a finished install is not an install.
    if (!fs.existsSync(target) && !fs.existsSync(path.join(dir, METADATA_FILENAME))) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    const cancelled = options.signal?.aborted || (error as Error).name === 'AbortError'
    const failure =
      error instanceof DownloadError
        ? error
        : new DownloadError(
            cancelled ? 'Download cancelled.' : `Download failed: ${(error as Error).message}`,
            cancelled ? 'cancelled' : 'io'
          )
    emit(failure.code === 'cancelled' ? 'cancelled' : 'error', failure.message, true)
    throw failure
  }
}

/** Releases the file descriptor before the caller deletes the partial file. */
async function closeQuietly(sink: fs.WriteStream | null): Promise<void> {
  if (!sink || sink.destroyed) return
  await new Promise<void>((resolve) => {
    sink.once('close', () => resolve())
    sink.once('error', () => resolve())
    sink.destroy()
  })
}

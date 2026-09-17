import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { modelBenchmarksSchema, type ManagedModel, type RegistryModel } from '@shared/types'

export const MODEL_FILENAME = 'model.gguf'
export const METADATA_FILENAME = 'metadata.json'

/** Written next to every downloaded model so an install survives a settings reset. */
const metadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  parameters: z.string().default(''),
  quantization: z.string().default(''),
  version: z.string().default('1.0'),
  contextSize: z.number().int().positive().default(4096),
  sizeBytes: z.number().int().nonnegative().default(0),
  sha256: z.string().default(''),
  installedAt: z.number().int().nonnegative().default(0),
  benchmarks: modelBenchmarksSchema.nullish().transform((value) => value ?? null)
})
export type ModelMetadata = z.infer<typeof metadataSchema>

/** Ids become directory names, so they must not be able to escape the store. */
export function isSafeModelId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) && !id.includes('..')
}

export function modelDirectory(modelsDir: string, id: string): string {
  if (!isSafeModelId(id)) throw new Error(`Unsafe model id: ${id}`)
  return path.join(modelsDir, id)
}

export function modelFilePath(modelsDir: string, id: string): string {
  return path.join(modelDirectory(modelsDir, id), MODEL_FILENAME)
}

export function writeMetadata(modelsDir: string, meta: ModelMetadata): void {
  const dir = modelDirectory(modelsDir, meta.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, METADATA_FILENAME), JSON.stringify(meta, null, 2))
}

export function metadataFor(model: RegistryModel, sha256: string, sizeBytes: number): ModelMetadata {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    parameters: model.parameters,
    quantization: model.quantization,
    version: model.version,
    contextSize: model.contextSize,
    sizeBytes,
    sha256,
    installedAt: Date.now(),
    benchmarks: model.benchmarks
  }
}

/**
 * A model counts as installed only when both the weights and their metadata are
 * on disk — a half-finished download must never look ready.
 */
export function listInstalled(modelsDir: string, registry: RegistryModel[] = []): ManagedModel[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(modelsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }

  const installed: ManagedModel[] = []
  for (const id of entries) {
    if (!isSafeModelId(id)) continue
    const dir = path.join(modelsDir, id)
    const filePath = path.join(dir, MODEL_FILENAME)
    let meta: ModelMetadata
    try {
      meta = metadataSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, METADATA_FILENAME), 'utf8')))
    } catch {
      continue
    }
    if (!fs.existsSync(filePath)) continue

    const latest = registry.find((m) => m.id === meta.id) ?? null
    installed.push({
      ...meta,
      filePath,
      updateAvailable: latest !== null && latest.version !== meta.version,
      latestVersion: latest?.version ?? null
    })
  }
  return installed.sort((a, b) => a.name.localeCompare(b.name))
}

export function findInstalled(modelsDir: string, id: string): ManagedModel | null {
  return listInstalled(modelsDir).find((model) => model.id === id) ?? null
}

/**
 * Removes a DocMind-managed model directory and nothing else. Custom GGUF files
 * live outside the store and are never touched by this function.
 */
export function deleteInstalled(modelsDir: string, id: string): void {
  const dir = modelDirectory(modelsDir, id)
  const resolved = path.resolve(dir)
  if (path.relative(path.resolve(modelsDir), resolved).startsWith('..')) {
    throw new Error(`Refusing to delete outside the model store: ${resolved}`)
  }
  if (!fs.existsSync(path.join(resolved, METADATA_FILENAME))) {
    throw new Error(`${id} is not a DocMind-managed model.`)
  }
  fs.rmSync(resolved, { recursive: true, force: true })
}

/** True when the path lives inside the DocMind model store. */
export function isManagedPath(modelsDir: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(modelsDir), path.resolve(filePath))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

import fs from 'node:fs'
import path from 'node:path'
import {
  PROVIDER_KIND,
  PROVIDER_LABEL,
  PROVIDER_PRIVACY,
  type DownloadProgress,
  type GgufFileInfo,
  type ManagedModel,
  type ModelCatalog,
  type ProviderHealth,
  type RegistryState,
  type Settings
} from '@shared/types'
import { detectClaude } from '../llm/claude-code'
import { detectCodex } from '../llm/codex'
import { inspectGguf } from '../llm/gguf'
import { downloadModel } from './download'
import { detectHardware } from './hardware'
import { loadRegistry, resolveRegistryUrl } from './registry'
import { deleteInstalled, findInstalled, listInstalled } from './store'

const HEALTH_TTL_MS = 30_000

export interface ModelsService {
  modelsDir: string
  catalog(refresh?: boolean): Promise<ModelCatalog>
  registry(refresh?: boolean): Promise<RegistryState>
  download(modelId: string, onProgress: (progress: DownloadProgress) => void): Promise<ManagedModel>
  cancelDownload(modelId: string): boolean
  remove(modelId: string): void
  installed(): ManagedModel[]
  providerHealth(refresh?: boolean): Promise<ProviderHealth[]>
}

/**
 * Owns everything about "which models exist and where": the remote catalog, the
 * downloaded ones, the imported ones and the state of each provider. Kept apart
 * from ModelManager, which only owns the single loaded provider.
 */
export function createModelsService(userDataDir: string, getSettings: () => Settings): ModelsService {
  const modelsDir = path.join(userDataDir, 'models')
  const cacheFile = path.join(modelsDir, 'registry-cache.json')
  const downloads = new Map<string, AbortController>()

  let registryState: RegistryState | null = null
  let health: { at: number; value: ProviderHealth[] } | null = null

  const registry = async (refresh = false): Promise<RegistryState> => {
    if (registryState && !refresh) return registryState
    const settings = getSettings()
    registryState = await loadRegistry({
      url: resolveRegistryUrl(settings.providers.registryUrl),
      cacheFile
    })
    return registryState
  }

  const localHealth = (settings: Settings): ProviderHealth[] => {
    const modelPath = settings.model.modelPath
    const hasFile = modelPath !== '' && fs.existsSync(modelPath)
    return [
      {
        id: 'local-gguf',
        kind: PROVIDER_KIND['local-gguf'],
        label: PROVIDER_LABEL['local-gguf'],
        state: hasFile ? 'ready' : 'unconfigured',
        detail: hasFile ? path.basename(modelPath) : 'No GGUF model selected yet.',
        privacy: PROVIDER_PRIVACY['local-gguf'],
        version: null,
        acknowledged: true,
        setupHint: hasFile ? null : 'Download a DocMind model or import your own .gguf file.'
      },
      {
        id: 'ollama',
        kind: PROVIDER_KIND.ollama,
        label: PROVIDER_LABEL.ollama,
        state: settings.model.ollamaModel ? 'ready' : 'unconfigured',
        detail: settings.model.ollamaModel || 'No Ollama model selected yet.',
        privacy: PROVIDER_PRIVACY.ollama,
        version: null,
        acknowledged: true,
        setupHint: settings.model.ollamaModel ? null : 'Start `ollama serve` and pick a pulled model.'
      }
    ]
  }

  const providerHealth = async (refresh = false): Promise<ProviderHealth[]> => {
    if (health && !refresh && Date.now() - health.at < HEALTH_TTL_MS) return health.value
    const settings = getSettings()
    const acknowledged = settings.providers.privacyAcknowledged
    const [codex, claude] = await Promise.all([
      detectCodex({
        acknowledged: acknowledged.includes('codex-cli'),
        allowWithApiKey: settings.providers.allowCodexWithApiKey
      }).catch((error: Error) => errorHealth('codex-cli', error)),
      detectClaude({
        acknowledged: acknowledged.includes('claude-code-cli'),
        allowWithApiKey: settings.providers.allowClaudeWithApiKey
      }).catch((error: Error) => errorHealth('claude-code-cli', error))
    ])
    const value = [...localHealth(settings), codex, claude]
    health = { at: Date.now(), value }
    return value
  }

  const installed = (): ManagedModel[] => listInstalled(modelsDir, registryState?.models ?? [])

  return {
    modelsDir,
    registry,
    installed,
    providerHealth,

    async catalog(refresh = false) {
      const settings = getSettings()
      const [state, providers] = await Promise.all([registry(refresh), providerHealth(refresh)])
      const custom = await Promise.all(settings.providers.customModelPaths.map((file) => inspectGguf(file)))
      const active = settings.model.provider
      return {
        hardware: detectHardware(),
        registry: state,
        installed: listInstalled(modelsDir, state.models),
        custom: custom as GgufFileInfo[],
        providers,
        active: {
          provider: active,
          model:
            active === 'ollama'
              ? settings.model.ollamaModel
              : active === 'local-gguf'
                ? path.basename(settings.model.modelPath || '')
                : PROVIDER_LABEL[active],
          label: PROVIDER_LABEL[active]
        },
        modelsDirectory: modelsDir
      }
    },

    async download(modelId, onProgress) {
      if (downloads.has(modelId)) throw new Error(`${modelId} is already downloading.`)
      const state = await registry()
      const model = state.models.find((entry) => entry.id === modelId)
      if (!model) throw new Error(`"${modelId}" is not in the model catalog.`)

      const controller = new AbortController()
      downloads.set(modelId, controller)
      try {
        return await downloadModel({ model, modelsDir, onProgress, signal: controller.signal })
      } finally {
        downloads.delete(modelId)
      }
    },

    cancelDownload(modelId) {
      const controller = downloads.get(modelId)
      if (!controller) return false
      controller.abort()
      return true
    },

    remove(modelId) {
      if (downloads.has(modelId)) throw new Error('Cancel the download before deleting this model.')
      if (!findInstalled(modelsDir, modelId)) throw new Error(`${modelId} is not installed.`)
      deleteInstalled(modelsDir, modelId)
    }
  }
}

function errorHealth(id: 'codex-cli' | 'claude-code-cli', error: Error): ProviderHealth {
  return {
    id,
    kind: 'subscription',
    label: PROVIDER_LABEL[id],
    state: 'error',
    detail: error.message,
    privacy: PROVIDER_PRIVACY[id],
    version: null,
    acknowledged: false,
    setupHint: null
  }
}

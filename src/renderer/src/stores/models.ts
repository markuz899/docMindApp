import { create } from 'zustand'
import type { SelectModelInput } from '@shared/ipc'
import { PROVIDER_KIND, type DownloadProgress, type ModelCatalog, type ProviderId } from '@shared/types'
import { unwrap, useAppStore } from './app'

interface ModelsState {
  catalog: ModelCatalog | null
  loading: boolean
  error: string | null
  busy: string | null
  downloads: Record<string, DownloadProgress>
  /** Provider awaiting the first-time "what gets sent" confirmation. */
  pendingPrivacy: ProviderId | null

  load: (refresh?: boolean) => Promise<void>
  applyDownload: (progress: DownloadProgress) => void
  download: (modelId: string) => Promise<void>
  cancelDownload: (modelId: string) => Promise<void>
  remove: (modelId: string) => Promise<void>
  select: (input: SelectModelInput) => Promise<void>
  importCustom: () => Promise<void>
  forgetCustom: (filePath: string) => Promise<void>
  confirmPrivacy: () => Promise<void>
  dismissPrivacy: () => void
  setError: (error: string | null) => void
}

export const useModelsStore = create<ModelsState>((set, get) => ({
  catalog: null,
  loading: false,
  error: null,
  busy: null,
  downloads: {},
  pendingPrivacy: null,

  async load(refresh = false) {
    set({ loading: true })
    try {
      set({ catalog: await window.docmind.models.catalog(refresh).then(unwrap), error: null })
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ loading: false })
    }
  },

  applyDownload(progress) {
    set({ downloads: { ...get().downloads, [progress.modelId]: progress } })
    if (progress.phase === 'done') void get().load()
  },

  async download(modelId) {
    set({ error: null })
    try {
      await window.docmind.models.download(modelId).then(unwrap)
      await get().load()
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      const downloads = { ...get().downloads }
      delete downloads[modelId]
      set({ downloads })
    }
  },

  async cancelDownload(modelId) {
    await window.docmind.models.cancelDownload(modelId).catch(() => undefined)
  },

  async remove(modelId) {
    set({ busy: modelId, error: null })
    try {
      await window.docmind.models.remove(modelId).then(unwrap)
      await get().load()
      await useAppStore.getState().refreshModelStatus()
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ busy: null })
    }
  },

  async select(input) {
    const catalog = get().catalog
    const acknowledged =
      catalog?.providers.find((provider) => provider.id === input.provider)?.acknowledged ?? false
    // Cloud providers get an explicit, one-time confirmation before anything
    // leaves the machine.
    if (PROVIDER_KIND[input.provider] === 'subscription' && !acknowledged) {
      set({ pendingPrivacy: input.provider })
      return
    }

    set({ busy: input.provider, error: null })
    try {
      await window.docmind.models.select(input).then(unwrap)
      await useAppStore.getState().refreshSettings()
      await get().load(true)
    } catch (error) {
      set({ error: (error as Error).message })
      await get().load(true)
    } finally {
      set({ busy: null })
    }
  },

  async importCustom() {
    set({ error: null })
    try {
      const info = await window.docmind.models.importCustom().then(unwrap)
      if (info && !info.valid) set({ error: info.problem ?? 'That file is not a usable GGUF model.' })
      await useAppStore.getState().refreshSettings()
      await get().load()
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  async forgetCustom(filePath) {
    try {
      await window.docmind.models.forgetCustom(filePath).then(unwrap)
      await useAppStore.getState().refreshSettings()
      await get().load()
      await useAppStore.getState().refreshModelStatus()
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  async confirmPrivacy() {
    const provider = get().pendingPrivacy
    if (!provider) return
    set({ pendingPrivacy: null })
    try {
      await window.docmind.models.acknowledgePrivacy(provider).then(unwrap)
      await useAppStore.getState().refreshSettings()
      await get().load(true)
      await get().select({ provider })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  dismissPrivacy: () => set({ pendingPrivacy: null }),
  setError: (error) => set({ error })
}))

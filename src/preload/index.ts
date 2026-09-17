import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, type AskInput, type DocMindApi, type SelectModelInput } from '@shared/ipc'
import type { DownloadProgress, IndexProgress, ModelStatus, PipelineEvent, ProviderId } from '@shared/types'

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DocMindApi = {
  app: {
    info: () => ipcRenderer.invoke(CHANNELS.appInfo)
  },
  projects: {
    openDialog: () => ipcRenderer.invoke(CHANNELS.projectOpenDialog),
    openPath: (folder: string) => ipcRenderer.invoke(CHANNELS.projectOpenPath, folder),
    list: () => ipcRenderer.invoke(CHANNELS.projectList),
    current: () => ipcRenderer.invoke(CHANNELS.projectCurrent),
    select: (projectId: number) => ipcRenderer.invoke(CHANNELS.projectSelect, projectId),
    reindex: (projectId: number) => ipcRenderer.invoke(CHANNELS.projectReindex, projectId),
    remove: (projectId: number) => ipcRenderer.invoke(CHANNELS.projectRemove, projectId)
  },
  documents: {
    list: (projectId: number) => ipcRenderer.invoke(CHANNELS.documentList, projectId),
    get: (documentId: number) => ipcRenderer.invoke(CHANNELS.documentGet, documentId)
  },
  chat: {
    conversations: (projectId: number) => ipcRenderer.invoke(CHANNELS.chatConversations, projectId),
    createConversation: (projectId: number, title: string) =>
      ipcRenderer.invoke(CHANNELS.chatCreateConversation, projectId, title),
    deleteConversation: (conversationId: number) =>
      ipcRenderer.invoke(CHANNELS.chatDeleteConversation, conversationId),
    messages: (conversationId: number) => ipcRenderer.invoke(CHANNELS.chatMessages, conversationId),
    ask: (input: AskInput) => ipcRenderer.invoke(CHANNELS.chatAsk, input),
    cancel: () => ipcRenderer.invoke(CHANNELS.chatCancel)
  },
  models: {
    status: () => ipcRenderer.invoke(CHANNELS.modelStatus),
    chooseGguf: () => ipcRenderer.invoke(CHANNELS.modelChooseGguf),
    inspect: (filePath: string) => ipcRenderer.invoke(CHANNELS.modelInspect, filePath),
    ollamaModels: (baseUrl: string) => ipcRenderer.invoke(CHANNELS.modelOllamaList, baseUrl),
    load: () => ipcRenderer.invoke(CHANNELS.modelLoad),
    unload: () => ipcRenderer.invoke(CHANNELS.modelUnload),
    catalog: (refresh?: boolean) => ipcRenderer.invoke(CHANNELS.modelCatalog, refresh ?? false),
    refreshRegistry: () => ipcRenderer.invoke(CHANNELS.modelRegistryRefresh),
    download: (modelId: string) => ipcRenderer.invoke(CHANNELS.modelDownload, modelId),
    cancelDownload: (modelId: string) => ipcRenderer.invoke(CHANNELS.modelDownloadCancel, modelId),
    remove: (modelId: string) => ipcRenderer.invoke(CHANNELS.modelDelete, modelId),
    select: (input: SelectModelInput) => ipcRenderer.invoke(CHANNELS.modelSelect, input),
    importCustom: () => ipcRenderer.invoke(CHANNELS.modelImportCustom),
    forgetCustom: (filePath: string) => ipcRenderer.invoke(CHANNELS.modelForgetCustom, filePath),
    acknowledgePrivacy: (provider: ProviderId) => ipcRenderer.invoke(CHANNELS.modelAcknowledge, provider),
    revealStore: () => ipcRenderer.invoke(CHANNELS.modelRevealStore)
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    update: (patch: unknown) => ipcRenderer.invoke(CHANNELS.settingsUpdate, patch)
  },
  events: {
    onPipeline: (handler: (event: PipelineEvent) => void) => subscribe(CHANNELS.eventPipeline, handler),
    onIndex: (handler: (progress: IndexProgress) => void) => subscribe(CHANNELS.eventIndex, handler),
    onModelStatus: (handler: (status: ModelStatus) => void) => subscribe(CHANNELS.eventModelStatus, handler),
    onModelDownload: (handler: (progress: DownloadProgress) => void) =>
      subscribe(CHANNELS.eventModelDownload, handler)
  }
}

contextBridge.exposeInMainWorld('docmind', api)

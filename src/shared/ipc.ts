import type {
  AskResult,
  ChatMessage,
  ConversationSummary,
  DocumentDetail,
  DocumentSummary,
  DownloadProgress,
  GgufFileInfo,
  IndexProgress,
  IndexReport,
  ManagedModel,
  ModelCatalog,
  ModelStatus,
  OllamaModelInfo,
  PipelineEvent,
  ProjectSummary,
  ProviderId,
  RegistryState,
  Result,
  Settings
} from './types'

export const CHANNELS = {
  appInfo: 'app:info',
  projectOpenDialog: 'project:open-dialog',
  projectOpenPath: 'project:open-path',
  projectList: 'project:list',
  projectCurrent: 'project:current',
  projectSelect: 'project:select',
  projectReindex: 'project:reindex',
  projectRemove: 'project:remove',
  documentList: 'document:list',
  documentGet: 'document:get',
  chatConversations: 'chat:conversations',
  chatCreateConversation: 'chat:create-conversation',
  chatDeleteConversation: 'chat:delete-conversation',
  chatMessages: 'chat:messages',
  chatAsk: 'chat:ask',
  chatCancel: 'chat:cancel',
  modelStatus: 'model:status',
  modelChooseGguf: 'model:choose-gguf',
  modelInspect: 'model:inspect',
  modelOllamaList: 'model:ollama-list',
  modelLoad: 'model:load',
  modelUnload: 'model:unload',
  modelCatalog: 'model:catalog',
  modelRegistryRefresh: 'model:registry-refresh',
  modelDownload: 'model:download',
  modelDownloadCancel: 'model:download-cancel',
  modelDelete: 'model:delete',
  modelSelect: 'model:select',
  modelImportCustom: 'model:import-custom',
  modelForgetCustom: 'model:forget-custom',
  modelAcknowledge: 'model:acknowledge-privacy',
  modelRevealStore: 'model:reveal-store',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  eventPipeline: 'event:pipeline',
  eventIndex: 'event:index',
  eventModelStatus: 'event:model-status',
  eventModelDownload: 'event:model-download'
} as const

export interface AppInfo {
  version: string
  databasePath: string
  platform: string
  electron: string
}

export interface AskInput {
  conversationId: number | null
  question: string
}

/** Everything needed to switch the active provider in one round trip. */
export interface SelectModelInput {
  provider: ProviderId
  /** Installed DocMind model id, for provider "local-gguf". */
  managedModelId?: string
  /** Custom GGUF path, for provider "local-gguf". */
  modelPath?: string
  /** Tag, for provider "ollama". */
  ollamaModel?: string
  ollamaUrl?: string
}

export interface DocMindApi {
  app: {
    info(): Promise<Result<AppInfo>>
  }
  projects: {
    openDialog(): Promise<Result<ProjectSummary | null>>
    openPath(folder: string): Promise<Result<ProjectSummary>>
    list(): Promise<Result<ProjectSummary[]>>
    current(): Promise<Result<ProjectSummary | null>>
    select(projectId: number): Promise<Result<ProjectSummary>>
    reindex(projectId: number): Promise<Result<IndexReport>>
    remove(projectId: number): Promise<Result<null>>
  }
  documents: {
    list(projectId: number): Promise<Result<DocumentSummary[]>>
    get(documentId: number): Promise<Result<DocumentDetail>>
  }
  chat: {
    conversations(projectId: number): Promise<Result<ConversationSummary[]>>
    createConversation(projectId: number, title: string): Promise<Result<ConversationSummary>>
    deleteConversation(conversationId: number): Promise<Result<null>>
    messages(conversationId: number): Promise<Result<ChatMessage[]>>
    ask(input: AskInput): Promise<Result<AskResult>>
    cancel(): Promise<Result<null>>
  }
  models: {
    status(): Promise<Result<ModelStatus>>
    chooseGguf(): Promise<Result<GgufFileInfo | null>>
    inspect(filePath: string): Promise<Result<GgufFileInfo>>
    ollamaModels(baseUrl: string): Promise<Result<OllamaModelInfo[]>>
    load(): Promise<Result<ModelStatus>>
    unload(): Promise<Result<ModelStatus>>
    catalog(refresh?: boolean): Promise<Result<ModelCatalog>>
    refreshRegistry(): Promise<Result<RegistryState>>
    download(modelId: string): Promise<Result<ManagedModel>>
    cancelDownload(modelId: string): Promise<Result<boolean>>
    remove(modelId: string): Promise<Result<null>>
    select(input: SelectModelInput): Promise<Result<ModelStatus>>
    importCustom(): Promise<Result<GgufFileInfo | null>>
    forgetCustom(filePath: string): Promise<Result<null>>
    acknowledgePrivacy(provider: ProviderId): Promise<Result<Settings>>
    revealStore(): Promise<Result<null>>
  }
  settings: {
    get(): Promise<Result<Settings>>
    update(patch: unknown): Promise<Result<Settings>>
  }
  events: {
    onPipeline(handler: (event: PipelineEvent) => void): () => void
    onIndex(handler: (progress: IndexProgress) => void): () => void
    onModelStatus(handler: (status: ModelStatus) => void): () => void
    onModelDownload(handler: (progress: DownloadProgress) => void): () => void
  }
}

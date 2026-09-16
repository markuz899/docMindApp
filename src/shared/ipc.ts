import type {
  AskResult,
  ChatMessage,
  ConversationSummary,
  DocumentDetail,
  DocumentSummary,
  GgufFileInfo,
  IndexProgress,
  IndexReport,
  ModelStatus,
  OllamaModelInfo,
  PipelineEvent,
  ProjectSummary,
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
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  eventPipeline: 'event:pipeline',
  eventIndex: 'event:index',
  eventModelStatus: 'event:model-status'
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
  }
  settings: {
    get(): Promise<Result<Settings>>
    update(patch: unknown): Promise<Result<Settings>>
  }
  events: {
    onPipeline(handler: (event: PipelineEvent) => void): () => void
    onIndex(handler: (progress: IndexProgress) => void): () => void
    onModelStatus(handler: (status: ModelStatus) => void): () => void
  }
}

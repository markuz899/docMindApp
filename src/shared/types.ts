import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* Query analysis                                                      */
/* ------------------------------------------------------------------ */

export const INTENTS = [
  'question',
  'bug_investigation',
  'architecture',
  'how_it_works',
  'dependency',
  'error',
  'data_flow'
] as const

export const intentSchema = z.enum(INTENTS)
export type Intent = z.infer<typeof intentSchema>

export const queryAnalysisSchema = z.object({
  originalQuery: z.string(),
  symbols: z.array(z.string()),
  keywords: z.array(z.string()),
  intent: intentSchema
})
export type QueryAnalysis = z.infer<typeof queryAnalysisSchema>

/* ------------------------------------------------------------------ */
/* Retrieval                                                           */
/* ------------------------------------------------------------------ */

export interface ScoreBreakdown {
  exactSymbol: number
  heading: number
  filename: number
  fts: number
  keyword: number
  intent: number
}

export interface RetrievedSection {
  sectionId: number
  documentId: number
  filename: string
  relativePath: string
  heading: string
  headingPath: string
  content: string
  startLine: number
  endLine: number
  tokens: number
  score: number
  breakdown: ScoreBreakdown
  matchedSymbols: string[]
  selected: boolean
}

export interface Source {
  sectionId: number
  documentId: number
  filename: string
  relativePath: string
  heading: string
  headingPath: string
  startLine: number
  endLine: number
  relevance: number
  excerpt: string
}

export interface Timings {
  analysisMs: number
  searchMs: number
  rankingMs: number
  contextMs: number
  generationMs: number
  totalMs: number
}

export interface GenerationStats {
  promptTokens: number
  generatedTokens: number
  tokensPerSecond: number
  generationMs: number
  provider: string
  model: string
}

/* ------------------------------------------------------------------ */
/* Pipeline events (main -> renderer, real activity only)              */
/* ------------------------------------------------------------------ */

export type PipelineEvent =
  | { type: 'query_received'; runId: string; query: string; conversationId: number }
  | { type: 'query_analyzed'; runId: string; analysis: QueryAnalysis; durationMs: number }
  | { type: 'search_started'; runId: string; sections: number; documents: number; ftsQuery: string }
  | {
      type: 'search_match'
      runId: string
      sectionId: number
      documentId: number
      document: string
      heading: string
      score: number
      via: 'exact' | 'fts'
    }
  | { type: 'search_completed'; runId: string; candidates: number; durationMs: number }
  | { type: 'ranking_started'; runId: string; candidates: number }
  | { type: 'ranking_completed'; runId: string; ranked: RetrievedSection[]; durationMs: number }
  | {
      type: 'context_selected'
      runId: string
      sections: number
      characters: number
      estimatedTokens: number
      sources: Source[]
    }
  | { type: 'generation_started'; runId: string; provider: string; model: string }
  | { type: 'generation_token'; runId: string; token: string }
  | { type: 'generation_completed'; runId: string; stats: GenerationStats; timings: Timings }
  | { type: 'cancelled'; runId: string; stage: string }
  | { type: 'error'; runId: string; stage: string; message: string }

export type PipelineEventType = PipelineEvent['type']

/* ------------------------------------------------------------------ */
/* Indexing                                                            */
/* ------------------------------------------------------------------ */

export interface IndexReport {
  projectId: number
  added: number
  changed: number
  deleted: number
  unchanged: number
  sections: number
  words: number
  durationMs: number
  errors: { relativePath: string; message: string }[]
}

export type IndexProgress =
  | { phase: 'scanning'; scanned: number }
  | { phase: 'parsing'; file: string; done: number; total: number }
  | { phase: 'done'; report: IndexReport }

export interface ProjectStats {
  documents: number
  sections: number
  words: number
  lastIndexedAt: number | null
}

export interface ProjectSummary {
  id: number
  name: string
  path: string
  createdAt: number
  updatedAt: number
  lastIndexedAt: number | null
  stats: ProjectStats
}

export interface DocumentSummary {
  id: number
  relativePath: string
  filename: string
  sections: number
  words: number
  updatedAt: number
}

export interface SectionView {
  id: number
  documentId: number
  heading: string
  headingPath: string
  content: string
  startLine: number
  endLine: number
  tokens: number
}

export interface DocumentDetail {
  id: number
  relativePath: string
  filename: string
  content: string
  sections: SectionView[]
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export interface ConversationSummary {
  id: number
  projectId: number
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ChatMessage {
  id: number
  conversationId: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  sources: Source[]
  timings: Timings | null
  stats: GenerationStats | null
  analysis: QueryAnalysis | null
  error: string | null
}

export interface AskResult {
  runId: string
  conversationId: number
  userMessageId: number
  assistantMessageId: number
  answer: string
  sources: Source[]
  timings: Timings
  stats: GenerationStats | null
  analysis: QueryAnalysis
}

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

export type ModelState = 'unloaded' | 'loading' | 'ready' | 'generating' | 'error'

export const PROVIDER_IDS = ['none', 'local-gguf', 'ollama', 'codex-cli', 'claude-code-cli'] as const
export const providerIdSchema = z.enum(PROVIDER_IDS)
export type ProviderId = z.infer<typeof providerIdSchema>

/** Local runs on this machine; subscription sends the built context to a vendor. */
export type ProviderKind = 'none' | 'local' | 'ollama' | 'subscription'

export const PROVIDER_KIND: Record<ProviderId, ProviderKind> = {
  none: 'none',
  'local-gguf': 'local',
  ollama: 'ollama',
  'codex-cli': 'subscription',
  'claude-code-cli': 'subscription'
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  none: 'Retrieval only',
  'local-gguf': 'Local GGUF',
  ollama: 'Ollama',
  'codex-cli': 'Codex',
  'claude-code-cli': 'Claude Code'
}

/**
 * Exact, non-negotiable wording: the difference between "this never leaves the
 * machine" and "this is uploaded to a vendor" is the only thing a user cannot
 * recover from getting wrong.
 */
export const PROVIDER_PRIVACY: Record<ProviderId, string> = {
  none: 'Runs entirely on this computer. Nothing is sent to an AI provider.',
  'local-gguf': 'Runs entirely on this computer. Your project context is not sent to an AI provider.',
  ollama:
    'Runs entirely on this computer through the local Ollama daemon. Your project context is not sent to an AI provider.',
  'codex-cli': 'Relevant documentation selected by retrieval will be sent to OpenAI through Codex.',
  'claude-code-cli': 'Relevant documentation selected by retrieval will be sent to Anthropic through Claude Code.'
}

export type ProviderHealthState =
  | 'ready'
  | 'not_installed'
  | 'not_authenticated'
  | 'api_billing_risk'
  | 'unconfigured'
  | 'error'

export interface ProviderHealth {
  id: ProviderId
  kind: ProviderKind
  label: string
  state: ProviderHealthState
  detail: string
  privacy: string
  version: string | null
  acknowledged: boolean
  setupHint: string | null
}

export interface ModelStatus {
  state: ModelState
  provider: ProviderId
  model: string
  detail: string
  contextSize: number
  lastError: string | null
}

export interface GgufFileInfo {
  path: string
  filename: string
  sizeBytes: number
  contextSize: number | null
  architecture: string | null
  parameters: string | null
  valid: boolean
  problem: string | null
}

export interface OllamaModelInfo {
  name: string
  sizeBytes: number
}

/* ------------------------------------------------------------------ */
/* Model registry                                                      */
/* ------------------------------------------------------------------ */

/** Optional and always nullable: a metric is shown only once it is measured. */
export const modelBenchmarksSchema = z.object({
  citationF1: z.number().nullable().default(null),
  hallucinationRate: z.number().nullable().default(null),
  usefulAnswerRate: z.number().nullable().default(null)
})
export type ModelBenchmarks = z.infer<typeof modelBenchmarksSchema>

export const registryModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  parameters: z.string().default(''),
  quantization: z.string().default(''),
  filename: z.string().min(1),
  // Plain HTTPS, so the files can move between Hugging Face and anywhere else
  // without the Model Manager knowing the difference.
  url: z.string().url().startsWith('https://', 'model downloads must use https'),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i, 'sha256 must be 64 hex characters'),
  recommendedRamGb: z.number().positive().default(8),
  minimumRamGb: z.number().positive().default(4),
  contextSize: z.number().int().min(512).max(131_072).default(4096),
  version: z.string().default('1.0'),
  benchmarks: modelBenchmarksSchema.nullish().transform((value) => value ?? null)
})
export type RegistryModel = z.infer<typeof registryModelSchema>

export const modelManifestSchema = z.object({
  version: z.literal(1),
  models: z.array(registryModelSchema)
})
export type ModelManifest = z.infer<typeof modelManifestSchema>

export interface RegistryState {
  source: 'remote' | 'cache' | 'none'
  url: string | null
  fetchedAt: number | null
  models: RegistryModel[]
  error: string | null
}

/* ------------------------------------------------------------------ */
/* Installed models                                                    */
/* ------------------------------------------------------------------ */

export interface ManagedModel {
  id: string
  name: string
  description: string
  parameters: string
  quantization: string
  version: string
  contextSize: number
  sizeBytes: number
  sha256: string
  filePath: string
  installedAt: number
  benchmarks: ModelBenchmarks | null
  /** Set by comparing the installed version against the current manifest. */
  updateAvailable: boolean
  latestVersion: string | null
}

export type DownloadPhase =
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'done'
  | 'error'
  | 'cancelled'

export interface DownloadProgress {
  modelId: string
  phase: DownloadPhase
  receivedBytes: number
  totalBytes: number
  percent: number
  bytesPerSecond: number
  message: string | null
}

export interface HardwareInfo {
  platform: string
  arch: string
  appleSilicon: boolean
  totalMemoryBytes: number
  totalMemoryGb: number
  cpuCount: number
}

export type ModelFit = 'recommended' | 'compatible' | 'too_large'

export interface ModelCatalog {
  hardware: HardwareInfo
  registry: RegistryState
  installed: ManagedModel[]
  custom: GgufFileInfo[]
  providers: ProviderHealth[]
  active: { provider: ProviderId; model: string; label: string }
  modelsDirectory: string
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const retrievalSettingsSchema = z.object({
  maxSections: z.number().int().min(1).max(20).default(6),
  minSections: z.number().int().min(1).max(20).default(3),
  maxContextChars: z.number().int().min(1000).max(200_000).default(14_000),
  candidateLimit: z.number().int().min(10).max(500).default(80),
  exactMatchBoost: z.number().min(0).max(10).default(3.5),
  headingBoost: z.number().min(0).max(10).default(2),
  filenameBoost: z.number().min(0).max(10).default(1),
  ftsWeight: z.number().min(0).max(10).default(1.5),
  keywordWeight: z.number().min(0).max(10).default(1)
})
export type RetrievalSettings = z.infer<typeof retrievalSettingsSchema>

export const modelSettingsSchema = z.object({
  provider: providerIdSchema.default('none'),
  modelPath: z.string().default(''),
  /** Non-empty when modelPath points at a model DocMind downloaded itself. */
  managedModelId: z.string().default(''),
  contextSize: z.number().int().min(512).max(131_072).default(4096),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().min(32).max(8192).default(768),
  threads: z.number().int().min(0).max(64).default(0),
  gpuLayers: z.number().int().min(-1).max(200).default(-1),
  ollamaUrl: z.string().default('http://127.0.0.1:11434'),
  ollamaModel: z.string().default('')
})
export type ModelSettings = z.infer<typeof modelSettingsSchema>

export const appearanceSettingsSchema = z.object({
  theme: z.enum(['dark', 'light']).default('dark'),
  accent: z.enum(['violet', 'cyan', 'amber', 'emerald']).default('violet'),
  compact: z.boolean().default(false),
  showGraph: z.boolean().default(true)
})
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>

export const generalSettingsSchema = z.object({
  reindexOnOpen: z.boolean().default(true),
  extensions: z.array(z.string()).default(['.md', '.mdx', '.txt']),
  ignoredDirectories: z
    .array(z.string())
    .default(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', 'vendor']),
  maxFileSizeKb: z.number().int().min(16).max(20_000).default(2048)
})
export type GeneralSettings = z.infer<typeof generalSettingsSchema>

/**
 * Everything the provider manager has to remember. Credentials are deliberately
 * absent: the CLI providers authenticate themselves and DocMind never reads,
 * copies or stores a token.
 */
export const providerSettingsSchema = z.object({
  registryUrl: z.string().default(''),
  customModelPaths: z.array(z.string()).default([]),
  privacyAcknowledged: z.array(providerIdSchema).default([]),
  allowCodexWithApiKey: z.boolean().default(false),
  allowClaudeWithApiKey: z.boolean().default(false),
  codexModel: z.string().default(''),
  claudeModel: z.string().default('')
})
export type ProviderSettings = z.infer<typeof providerSettingsSchema>

export const settingsSchema = z.object({
  general: generalSettingsSchema.default({}),
  retrieval: retrievalSettingsSchema.default({}),
  model: modelSettingsSchema.default({}),
  providers: providerSettingsSchema.default({}),
  appearance: appearanceSettingsSchema.default({})
})
export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})

/* ------------------------------------------------------------------ */
/* IPC envelope                                                        */
/* ------------------------------------------------------------------ */

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

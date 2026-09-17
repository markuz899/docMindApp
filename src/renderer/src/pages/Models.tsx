import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  FileCode2,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import {
  PROVIDER_PRIVACY,
  type GgufFileInfo,
  type ManagedModel,
  type OllamaModelInfo,
  type ProviderHealth,
  type ProviderId,
  type RegistryModel
} from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs } from '@/components/ui/tabs'
import { cn, formatBytes, formatNumber, formatRelativeTime } from '@/lib/utils'
import { unwrap, useAppStore } from '@/stores/app'
import { useModelsStore } from '@/stores/models'

type Section = 'local' | 'subscription' | 'advanced'

function speed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

/* ------------------------------------------------------------------ */
/* Local models                                                        */
/* ------------------------------------------------------------------ */

function RegistryCard({ model }: { model: RegistryModel }): JSX.Element {
  const { catalog, downloads, busy, download, cancelDownload, remove, select } = useModelsStore()
  const settings = useAppStore((s) => s.settings)
  const installed = catalog?.installed.find((entry) => entry.id === model.id) ?? null
  const progress = downloads[model.id]
  const active = installed !== null && settings.model.provider === 'local-gguf' && settings.model.modelPath === installed.filePath
  const ram = catalog?.hardware.totalMemoryGb ?? 0
  const fit = ram >= model.recommendedRamGb ? 'recommended' : ram >= model.minimumRamGb ? 'compatible' : 'too_large'

  return (
    <div className="rounded-lg border border-border bg-elevated/40 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            {model.name}
            {active ? (
              <Badge variant="success">
                <CheckCircle2 className="h-3 w-3" /> active
              </Badge>
            ) : null}
            {installed?.updateAvailable ? <Badge variant="warning">update available</Badge> : null}
          </p>
          <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {[model.parameters, model.quantization, formatBytes(model.sizeBytes), `v${model.version}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Badge variant={fit === 'recommended' ? 'success' : fit === 'compatible' ? 'muted' : 'danger'}>
          {fit === 'too_large' ? `needs ${model.minimumRamGb} GB` : fit}
        </Badge>
      </div>

      {model.description ? <p className="mt-2 text-[12px] text-muted-foreground">{model.description}</p> : null}

      {model.benchmarks &&
      (model.benchmarks.citationF1 !== null ||
        model.benchmarks.hallucinationRate !== null ||
        model.benchmarks.usefulAnswerRate !== null) ? (
        <dl className="mt-2.5 flex flex-wrap gap-4 text-[11px]">
          {(
            [
              ['Citation F1', model.benchmarks.citationF1],
              ['Hallucination', model.benchmarks.hallucinationRate],
              ['Useful answers', model.benchmarks.usefulAnswerRate]
            ] as const
          )
            .filter(([, value]) => value !== null)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-[9.5px] uppercase tracking-wider text-muted-foreground/70">{label}</dt>
                <dd className="font-mono tabular-nums">{value}</dd>
              </div>
            ))}
        </dl>
      ) : null}

      {progress && progress.phase !== 'done' ? (
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent * 100}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {progress.phase === 'downloading'
                ? `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)} · ${Math.round(progress.percent * 100)}%`
                : (progress.message ?? progress.phase)}
            </span>
            <span className="font-mono tabular-nums">
              {progress.phase === 'downloading' ? speed(progress.bytesPerSecond) : ''}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void cancelDownload(model.id)}>
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {installed ? (
            <>
              <Button
                size="sm"
                disabled={active || busy !== null}
                onClick={() => void select({ provider: 'local-gguf', managedModelId: model.id })}
              >
                {active ? 'Active' : 'Use model'}
              </Button>
              {installed.updateAvailable ? (
                <Button size="sm" variant="outline" onClick={() => void download(model.id)}>
                  <Download className="h-3.5 w-3.5" />
                  Update to v{model.version}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => void confirmDelete(model.name, () => remove(model.id))}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void download(model.id)}>
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Confirmation stays in the renderer: a delete must never be one stray click. */
function confirmDelete(name: string, action: () => Promise<void>): Promise<void> | void {
  if (window.confirm(`Delete ${name}? The downloaded weights are removed from the DocMind model folder.`)) {
    return action()
  }
}

function InstalledOrphans({ models }: { models: ManagedModel[] }): JSX.Element | null {
  const { select, remove, busy } = useModelsStore()
  const settings = useAppStore((s) => s.settings)
  if (models.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Downloaded, not in the current catalog
      </p>
      {models.map((model) => {
        const active = settings.model.modelPath === model.filePath
        return (
          <div key={model.id} className="flex items-center gap-3 rounded-lg border border-border bg-elevated/40 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium">{model.name}</p>
              <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                {[model.parameters, model.quantization, formatBytes(model.sizeBytes), `v${model.version}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={active || busy !== null}
              onClick={() => void select({ provider: 'local-gguf', managedModelId: model.id })}
            >
              {active ? 'Active' : 'Use model'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void confirmDelete(model.name, () => remove(model.id))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function CustomModels({ models }: { models: GgufFileInfo[] }): JSX.Element {
  const { importCustom, forgetCustom, select, busy } = useModelsStore()
  const settings = useAppStore((s) => s.settings)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold">Custom GGUF</p>
          <p className="text-[11.5px] text-muted-foreground">
            Any quantized instruction-tuned model works. The file stays where it is — DocMind only remembers the path.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void importCustom()}>
          <FileCode2 className="h-3.5 w-3.5" />
          Import .gguf
        </Button>
      </div>

      {models.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No custom model imported yet.</p>
      ) : (
        models.map((model) => {
          const active = settings.model.provider === 'local-gguf' && settings.model.modelPath === model.path
          return (
            <div key={model.path} className="rounded-lg border border-border bg-elevated/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium">{model.filename}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{model.path}</p>
                </div>
                {model.valid ? (
                  active ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" /> active
                    </Badge>
                  ) : (
                    <Badge variant="muted">available</Badge>
                  )
                ) : (
                  <Badge variant="danger">
                    <AlertTriangle className="h-3 w-3" /> unusable
                  </Badge>
                )}
              </div>

              <dl className="mt-2.5 grid grid-cols-4 gap-3 text-[11.5px]">
                {[
                  ['Size', formatBytes(model.sizeBytes)],
                  ['Context', model.contextSize ? formatNumber(model.contextSize) : '—'],
                  ['Architecture', model.architecture ?? '—'],
                  ['Parameters', model.parameters ?? '—']
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</dt>
                    <dd className="mt-0.5 truncate font-mono">{value}</dd>
                  </div>
                ))}
              </dl>

              {model.problem ? <p className="mt-2 text-[11.5px] text-destructive">{model.problem}</p> : null}

              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={!model.valid || active || busy !== null}
                  onClick={() => void select({ provider: 'local-gguf', modelPath: model.path })}
                >
                  {active ? 'Active' : 'Use model'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void forgetCustom(model.path)}>
                  Remove from list
                </Button>
              </div>
            </div>
          )
        })
      )}
    </Card>
  )
}

function OllamaPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const { select, busy } = useModelsStore()
  const [url, setUrl] = useState(settings.model.ollamaUrl)
  const [models, setModels] = useState<OllamaModelInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setModels(await window.docmind.models.ollamaModels(url).then(unwrap))
    } catch (cause) {
      setModels([])
      setError((cause as Error).message)
    }
  }, [url])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Ollama daemon</span>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {models === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : models.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          {error ?? 'No models found.'} Start the daemon with <code className="font-mono text-accent">ollama serve</code>{' '}
          and pull one with <code className="font-mono text-accent">ollama pull qwen2.5:3b</code>.
        </p>
      ) : (
        <div className="space-y-1.5">
          {models.map((model) => {
            const active = settings.model.provider === 'ollama' && settings.model.ollamaModel === model.name
            return (
              <button
                key={model.name}
                type="button"
                disabled={busy !== null}
                onClick={() => void select({ provider: 'ollama', ollamaModel: model.name, ollamaUrl: url })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  active ? 'border-primary/50 bg-primary/8' : 'border-border bg-elevated/40 hover:border-primary/40'
                )}
              >
                <span className="flex-1 truncate font-mono text-[12px]">{model.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(model.sizeBytes)}</span>
                {active ? <Badge variant="success">active</Badge> : null}
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Subscription providers                                              */
/* ------------------------------------------------------------------ */

const STATE_DOT: Record<ProviderHealth['state'], string> = {
  ready: 'bg-success',
  not_installed: 'bg-muted-foreground/60',
  not_authenticated: 'bg-warning',
  api_billing_risk: 'bg-warning',
  unconfigured: 'bg-muted-foreground/60',
  error: 'bg-destructive'
}

const STATE_LABEL: Record<ProviderHealth['state'], string> = {
  ready: 'Ready',
  not_installed: 'Not installed',
  not_authenticated: 'Not authenticated',
  api_billing_risk: 'API key detected',
  unconfigured: 'Not configured',
  error: 'Error'
}

const SETUP_COMMANDS: Partial<Record<ProviderId, string[]>> = {
  'codex-cli': ['npm i -g @openai/codex', 'codex login'],
  'claude-code-cli': ['npm i -g @anthropic-ai/claude-code', 'claude auth login']
}

function SubscriptionCard({ health }: { health: ProviderHealth }): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const { select, busy } = useModelsStore()
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [showSetup, setShowSetup] = useState(false)
  const active = settings.model.provider === health.id
  const allowKey = health.id === 'codex-cli' ? 'allowCodexWithApiKey' : 'allowClaudeWithApiKey'
  const allowed = health.id === 'codex-cli' ? settings.providers.allowCodexWithApiKey : settings.providers.allowClaudeWithApiKey

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
            {health.label}
            {active ? (
              <Badge variant="success">
                <CheckCircle2 className="h-3 w-3" /> active
              </Badge>
            ) : null}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {health.id === 'codex-cli'
              ? 'Use your existing ChatGPT subscription through the Codex CLI. No API key, no metered billing.'
              : 'Use your existing Claude subscription through Claude Code. No API key, no metered billing.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11.5px] text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', STATE_DOT[health.state])} />
          {STATE_LABEL[health.state]}
        </div>
      </div>

      <p className="rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-[11.5px] text-warning">
        {health.privacy}
      </p>

      {health.state === 'api_billing_risk' ? (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/8 p-3">
          <p className="flex items-start gap-1.5 text-[11.5px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {health.detail}
          </p>
          <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
            <input
              type="checkbox"
              checked={allowed}
              onChange={(event) => void updateSettings({ providers: { [allowKey]: event.target.checked } })}
            />
            I understand this may bill my API account, not my subscription.
          </label>
        </div>
      ) : (
        <p className="text-[11.5px] text-muted-foreground">{health.detail}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={health.state !== 'ready' || active || busy !== null}
          onClick={() => void select({ provider: health.id })}
        >
          {active ? 'Active' : `Use ${health.label}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowSetup((value) => !value)}>
          Setup instructions
        </Button>
        {health.version ? <span className="font-mono text-[10.5px] text-muted-foreground">{health.version}</span> : null}
      </div>

      {showSetup ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-elevated/50 p-3">
          {health.setupHint ? <p className="text-[11.5px] text-muted-foreground">{health.setupHint}</p> : null}
          {(SETUP_COMMANDS[health.id] ?? []).map((command) => (
            <code key={command} className="block font-mono text-[11px] text-accent">
              {command}
            </code>
          ))}
          <p className="text-[11px] text-muted-foreground">
            DocMind never reads or stores your credentials — the CLI authenticates itself.
          </p>
        </div>
      ) : null}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Privacy confirmation                                                */
/* ------------------------------------------------------------------ */

function PrivacyDialog(): JSX.Element | null {
  const { pendingPrivacy, confirmPrivacy, dismissPrivacy } = useModelsStore()
  if (!pendingPrivacy) return null
  const vendor = pendingPrivacy === 'codex-cli' ? 'Codex' : 'Claude Code'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-[440px] space-y-4 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-warning" />
          <p className="text-[14px] font-semibold">Send documentation to {vendor}?</p>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          DocMind will send only the documentation excerpts selected by retrieval, together with your question, to{' '}
          {vendor}. The complete project is not uploaded automatically.
        </p>
        <p className="text-[11.5px] text-muted-foreground">{PROVIDER_PRIVACY[pendingPrivacy]}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismissPrivacy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void confirmPrivacy()}>
            Continue
          </Button>
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Models(): JSX.Element {
  const { settings, modelStatus, updateSettings } = useAppStore()
  const { catalog, loading, error, load, select, setError } = useModelsStore()
  const [section, setSection] = useState<Section>('local')
  const [registryUrl, setRegistryUrl] = useState(settings.providers.registryUrl)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => setRegistryUrl(settings.providers.registryUrl), [settings.providers.registryUrl])

  const registry = catalog?.registry
  const hardware = catalog?.hardware
  const catalogIds = new Set((registry?.models ?? []).map((model) => model.id))
  const orphans = (catalog?.installed ?? []).filter((model) => !catalogIds.has(model.id))
  const recommended = (registry?.models ?? []).filter((m) => (hardware?.totalMemoryGb ?? 0) >= m.recommendedRamGb)
  const compatible = (registry?.models ?? []).filter(
    (m) => (hardware?.totalMemoryGb ?? 0) >= m.minimumRamGb && (hardware?.totalMemoryGb ?? 0) < m.recommendedRamGb
  )

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <PrivacyDialog />
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Models</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Retrieval always runs locally. This page only decides which model writes the answer.
          </p>
        </div>

        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border',
                modelStatus.state === 'ready'
                  ? 'border-success/40 bg-success/10 text-success'
                  : modelStatus.state === 'error'
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-border bg-elevated text-muted-foreground'
              )}
            >
              <Cpu className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {modelStatus.model || 'No active model'}
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">{modelStatus.state}</span>
              </p>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {modelStatus.detail || 'pick a provider below'}
                {modelStatus.contextSize ? ` · ctx ${formatNumber(modelStatus.contextSize)}` : ''}
              </p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{PROVIDER_PRIVACY[modelStatus.provider]}</p>
              {modelStatus.lastError ? (
                <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {modelStatus.lastError}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </Card>

        <Tabs
          items={[
            { value: 'local', label: 'Local models' },
            { value: 'subscription', label: 'Subscription AI' },
            { value: 'advanced', label: 'Advanced' }
          ]}
          value={section}
          onChange={setSection}
        />

        {error ? (
          <p className="flex items-start gap-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" className="underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </p>
        ) : null}

        {section === 'local' ? (
          <div className="space-y-4">
            <Card className="p-4">
              <p className="flex items-center gap-2 text-[12.5px]">
                <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                {hardware
                  ? `${hardware.totalMemoryGb} GB RAM detected · ${hardware.platform}/${hardware.arch}${hardware.appleSilicon ? ' · Apple Silicon' : ''} · ${hardware.cpuCount} cores`
                  : 'Detecting hardware…'}
              </p>
              {registry && registry.models.length > 0 ? (
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  {recommended.length > 0 ? `Recommended: ${recommended.map((m) => m.name).join(', ')}. ` : ''}
                  {compatible.length > 0 ? `Compatible: ${compatible.map((m) => m.name).join(', ')}.` : ''}
                </p>
              ) : null}
              <p className="mt-1 text-[11.5px] text-success">{PROVIDER_PRIVACY['local-gguf']}</p>
            </Card>

            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold">DocMind models</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {registry?.source === 'cache'
                      ? `Model catalog last updated ${formatRelativeTime(registry.fetchedAt)} (offline copy).`
                      : registry?.source === 'remote'
                        ? `Model catalog updated ${formatRelativeTime(registry.fetchedAt)}.`
                        : 'No model catalog available.'}
                  </p>
                </div>
              </div>

              {registry?.error ? <p className="text-[11.5px] text-warning">{registry.error}</p> : null}

              {(registry?.models ?? []).length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  No downloadable models are configured. Set a registry URL under Advanced, or import a custom GGUF
                  file below.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {registry?.models.map((model) => (
                    <RegistryCard key={model.id} model={model} />
                  ))}
                </div>
              )}

              <InstalledOrphans models={orphans} />
            </Card>

            <CustomModels models={catalog?.custom ?? []} />
            <OllamaPanel />
          </div>
        ) : null}

        {section === 'subscription' ? (
          <div className="space-y-4">
            <p className="text-[12px] text-muted-foreground">
              These providers use a CLI you already installed and signed in to. DocMind never asks for an API key and
              never falls back to metered API billing.
            </p>
            {(catalog?.providers ?? [])
              .filter((provider) => provider.kind === 'subscription')
              .map((provider) => (
                <SubscriptionCard key={provider.id} health={provider} />
              ))}
          </div>
        ) : null}

        {section === 'advanced' ? (
          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <div>
                <p className="text-[13px] font-semibold">Model registry</p>
                <p className="text-[11.5px] text-muted-foreground">
                  A JSON manifest of downloadable DocMind models. Leave empty to use the{' '}
                  <code className="font-mono text-accent">DOCMIND_MODEL_REGISTRY_URL</code> environment variable.
                </p>
              </div>
              <div className="flex items-end gap-2">
                <Input
                  value={registryUrl}
                  placeholder="https://…/manifest.json"
                  onChange={(event) => setRegistryUrl(event.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    await updateSettings({ providers: { registryUrl } })
                    await load(true)
                  }}
                >
                  Save &amp; refresh
                </Button>
              </div>
            </Card>

            <Card className="space-y-3 p-4">
              <div>
                <p className="text-[13px] font-semibold">Model storage</p>
                <p className="break-all font-mono text-[10.5px] text-muted-foreground">
                  {catalog?.modelsDirectory ?? '—'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void window.docmind.models.revealStore()}>
                <FolderOpen className="h-3.5 w-3.5" />
                Reveal in file manager
              </Button>
            </Card>

            <Card className="space-y-3 p-4">
              <div>
                <p className="text-[13px] font-semibold">Retrieval only</p>
                <p className="text-[11.5px] text-muted-foreground">
                  With no model configured DocMind still parses, indexes and retrieves. Answers are replaced by the
                  ranked list of matching sections — useful for checking retrieval quality on its own.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={settings.model.provider === 'none'}
                onClick={() => void select({ provider: 'none' })}
              >
                Use retrieval only
              </Button>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  )
}

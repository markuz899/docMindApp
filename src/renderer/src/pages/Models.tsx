import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Cpu, Download, FileCode2, Loader2, Power, RefreshCw } from 'lucide-react'
import type { GgufFileInfo, OllamaModelInfo } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs } from '@/components/ui/tabs'
import { cn, formatBytes, formatNumber } from '@/lib/utils'
import { unwrap, useAppStore } from '@/stores/app'

type Provider = 'local-gguf' | 'ollama' | 'none'

export function Models(): JSX.Element {
  const { settings, modelStatus, updateSettings, refreshModelStatus } = useAppStore()
  const [provider, setProvider] = useState<Provider>(settings.model.provider)
  const [gguf, setGguf] = useState<GgufFileInfo | null>(null)
  const [ollama, setOllama] = useState<OllamaModelInfo[] | null>(null)
  const [ollamaUrl, setOllamaUrl] = useState(settings.model.ollamaUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setProvider(settings.model.provider), [settings.model.provider])

  useEffect(() => {
    if (!settings.model.modelPath) return
    window.docmind.models.inspect(settings.model.modelPath).then(unwrap).then(setGguf).catch(() => setGguf(null))
  }, [settings.model.modelPath])

  const loadOllama = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setOllama(await window.docmind.models.ollamaModels(ollamaUrl).then(unwrap))
    } catch (cause) {
      setOllama([])
      setError((cause as Error).message)
    }
  }, [ollamaUrl])

  useEffect(() => {
    if (provider === 'ollama') void loadOllama()
  }, [provider, loadOllama])

  const chooseFile = async (): Promise<void> => {
    setError(null)
    try {
      const info = await window.docmind.models.chooseGguf().then(unwrap)
      if (info) setGguf(info)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const activate = async (patch: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await updateSettings({ model: patch })
      await window.docmind.models.load().then(unwrap)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
      await refreshModelStatus()
    }
  }

  const activeGguf = settings.model.provider === 'local-gguf' && settings.model.modelPath === gguf?.path

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Model</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            DocMind runs the answer step on your machine. Point it at a GGUF file, or use a local Ollama daemon.
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
                {modelStatus.detail || 'select a provider below'}
                {modelStatus.contextSize ? ` · ctx ${formatNumber(modelStatus.contextSize)}` : ''}
              </p>
              {modelStatus.lastError ? (
                <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {modelStatus.lastError}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || settings.model.provider === 'none'}
                onClick={() => void activate({})}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                Load
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void window.docmind.models.unload().then(() => refreshModelStatus())}
              >
                Unload
              </Button>
            </div>
          </div>
        </Card>

        <Tabs
          items={[
            { value: 'local-gguf', label: 'Local GGUF' },
            { value: 'ollama', label: 'Ollama' },
            { value: 'none', label: 'Retrieval only' }
          ]}
          value={provider}
          onChange={setProvider}
        />

        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}

        {provider === 'local-gguf' ? (
          <Card className="space-y-4 p-4">
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => void chooseFile()}>
                <FileCode2 className="h-3.5 w-3.5" />
                Select .gguf file
              </Button>
              <Button variant="ghost" size="sm" disabled title="Automatic downloads are not implemented yet">
                <Download className="h-3.5 w-3.5" />
                Download a model
              </Button>
            </div>

            {gguf ? (
              <div className="rounded-lg border border-border bg-elevated/40 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{gguf.filename}</p>
                    <p className="truncate font-mono text-[10.5px] text-muted-foreground">{gguf.path}</p>
                  </div>
                  {gguf.valid ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" /> valid
                    </Badge>
                  ) : (
                    <Badge variant="danger">
                      <AlertTriangle className="h-3 w-3" /> invalid
                    </Badge>
                  )}
                </div>

                <dl className="mt-3 grid grid-cols-4 gap-3 text-[11.5px]">
                  {[
                    ['Size', formatBytes(gguf.sizeBytes)],
                    ['Context', gguf.contextSize ? formatNumber(gguf.contextSize) : '—'],
                    ['Architecture', gguf.architecture ?? '—'],
                    ['Parameters', gguf.parameters ?? '—']
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</dt>
                      <dd className="mt-0.5 truncate font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>

                {gguf.problem ? <p className="mt-2 text-[11.5px] text-destructive">{gguf.problem}</p> : null}

                <Button
                  className="mt-3.5"
                  size="sm"
                  disabled={!gguf.valid || busy || activeGguf}
                  onClick={() =>
                    void activate({
                      provider: 'local-gguf',
                      modelPath: gguf.path,
                      contextSize: Math.min(
                        settings.model.contextSize,
                        gguf.contextSize ?? settings.model.contextSize
                      )
                    })
                  }
                >
                  {activeGguf ? 'Active model' : 'Set as active model'}
                </Button>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                No GGUF selected yet. Any quantized instruction-tuned model works; 1–4B models answer fastest on a
                laptop.
              </p>
            )}
          </Card>
        ) : null}

        {provider === 'ollama' ? (
          <Card className="space-y-3 p-4">
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Daemon URL
                </span>
                <Input value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} />
              </label>
              <Button variant="outline" onClick={() => void loadOllama()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>

            {ollama === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : ollama.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No models found. Start the daemon with <code className="font-mono text-accent">ollama serve</code> and
                pull one with <code className="font-mono text-accent">ollama pull qwen2.5:3b</code>.
              </p>
            ) : (
              <div className="space-y-1.5">
                {ollama.map((model) => {
                  const active = settings.model.provider === 'ollama' && settings.model.ollamaModel === model.name
                  return (
                    <button
                      key={model.name}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void activate({ provider: 'ollama', ollamaModel: model.name, ollamaUrl })
                      }
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
        ) : null}

        {provider === 'none' ? (
          <Card className="p-4">
            <p className="text-[12.5px] text-muted-foreground">
              With no model configured DocMind still parses, indexes and retrieves. Answers are replaced by the ranked
              list of matching sections — useful for checking retrieval quality on its own.
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              disabled={settings.model.provider === 'none'}
              onClick={() => void updateSettings({ model: { provider: 'none' } })}
            >
              Use retrieval only
            </Button>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

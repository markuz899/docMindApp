import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cloud, Cpu, Server } from 'lucide-react'
import { PROVIDER_KIND, type ProviderHealth, type ProviderId } from '@shared/types'
import type { SelectModelInput } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useModelsStore } from '@/stores/models'

const STATE_DOT: Record<ProviderHealth['state'], string> = {
  ready: 'bg-success',
  not_installed: 'bg-muted-foreground/50',
  not_authenticated: 'bg-warning',
  api_billing_risk: 'bg-warning',
  unconfigured: 'bg-muted-foreground/50',
  error: 'bg-destructive'
}

interface Option {
  key: string
  label: string
  detail: string
  input: SelectModelInput
  active: boolean
  disabled: boolean
  dot: string
}

/** Quick switch in the toolbar; the AI Models page stays the full surface. */
export function ProviderSelector(): JSX.Element {
  const { modelStatus, settings, setRoute } = useAppStore()
  const { catalog, load, select, busy } = useModelsStore()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!catalog) void load()
  }, [catalog, load])

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const health = (id: ProviderId): ProviderHealth | undefined =>
    catalog?.providers.find((provider) => provider.id === id)

  const local: Option[] = (catalog?.installed ?? []).map((model) => ({
    key: `managed:${model.id}`,
    label: model.name,
    detail: [model.parameters, model.quantization].filter(Boolean).join(' · '),
    input: { provider: 'local-gguf', managedModelId: model.id },
    active: settings.model.provider === 'local-gguf' && settings.model.modelPath === model.filePath,
    disabled: false,
    dot: 'bg-success'
  }))

  const custom: Option[] = (catalog?.custom ?? [])
    .filter((model) => model.valid)
    .map((model) => ({
      key: `custom:${model.path}`,
      label: model.filename,
      detail: model.parameters ?? 'custom GGUF',
      input: { provider: 'local-gguf', modelPath: model.path },
      active: settings.model.provider === 'local-gguf' && settings.model.modelPath === model.path,
      disabled: false,
      dot: 'bg-success'
    }))

  const subscription: Option[] = (['codex-cli', 'claude-code-cli'] as const).map((id) => {
    const state = health(id)
    return {
      key: id,
      label: state?.label ?? id,
      detail: state?.state === 'ready' ? 'subscription · ready' : (state?.detail ?? 'unavailable'),
      input: { provider: id },
      active: settings.model.provider === id,
      disabled: state?.state !== 'ready',
      dot: STATE_DOT[state?.state ?? 'error']
    }
  })

  const other: Option[] = settings.model.ollamaModel
    ? [
        {
          key: 'ollama',
          label: settings.model.ollamaModel,
          detail: 'ollama',
          input: { provider: 'ollama', ollamaModel: settings.model.ollamaModel },
          active: settings.model.provider === 'ollama',
          disabled: false,
          dot: 'bg-success'
        }
      ]
    : []

  const groups: { title: string; icon: typeof Cpu; options: Option[] }[] = [
    { title: 'Local', icon: Cpu, options: [...local, ...custom] },
    { title: 'Subscription', icon: Cloud, options: subscription },
    { title: 'Other', icon: Server, options: other }
  ]

  const label =
    modelStatus.state === 'generating'
      ? 'Generating…'
      : modelStatus.state === 'loading'
        ? 'Loading…'
        : modelStatus.model || 'No model'

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="no-drag flex items-center gap-2 rounded-full border border-border bg-elevated/70 px-3 py-1.5 text-[11.5px] transition-colors hover:border-primary/40"
        title={modelStatus.lastError ?? modelStatus.detail}
      >
        {PROVIDER_KIND[modelStatus.provider] === 'subscription' ? (
          <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-muted-foreground">AI:</span>
        <span className="max-w-[160px] truncate">{label}</span>
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            modelStatus.state === 'ready'
              ? 'bg-success'
              : modelStatus.state === 'error'
                ? 'bg-destructive'
                : modelStatus.state === 'generating'
                  ? 'animate-pulse bg-primary'
                  : 'bg-muted-foreground/60'
          )}
        />
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open ? (
        <div className="no-drag absolute right-0 top-full z-50 mt-1.5 w-[268px] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          {groups.map((group) => (
            <div key={group.title} className="border-b border-border/60 last:border-b-0">
              <p className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                <group.icon className="h-3 w-3" />
                {group.title}
              </p>
              {group.options.length === 0 ? (
                <p className="px-3 pb-2 text-[11px] text-muted-foreground/70">nothing available</p>
              ) : (
                group.options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    disabled={option.disabled || busy !== null}
                    onClick={() => {
                      setOpen(false)
                      void select(option.input)
                    }}
                    className="no-drag flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-elevated disabled:opacity-45 disabled:hover:bg-transparent"
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', option.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px]">{option.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{option.detail}</span>
                    </span>
                    {option.active ? <Check className="h-3.5 w-3.5 shrink-0 text-success" /> : null}
                  </button>
                ))
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setRoute('models')
            }}
            className="no-drag w-full border-t border-border px-3 py-2 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
          >
            Manage AI models…
          </button>
        </div>
      ) : null}
    </div>
  )
}

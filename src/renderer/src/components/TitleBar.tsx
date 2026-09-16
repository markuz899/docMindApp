import { Cpu, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'

const STATE_COLOR: Record<string, string> = {
  ready: 'bg-success',
  generating: 'bg-primary',
  loading: 'bg-warning',
  error: 'bg-destructive',
  unloaded: 'bg-muted-foreground/60'
}

export function TitleBar(): JSX.Element {
  const { project, modelStatus, busy, reindex, openFolder, setRoute } = useAppStore()

  const label =
    modelStatus.state === 'generating'
      ? 'Generating…'
      : modelStatus.state === 'loading'
        ? 'Loading model…'
        : modelStatus.state === 'ready'
          ? `Local AI · ${modelStatus.model}`
          : modelStatus.provider === 'none'
            ? 'No model'
            : modelStatus.lastError
              ? 'Model error'
              : modelStatus.model || 'No model'

  return (
    <header className="drag-region flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface/80 pl-[92px] pr-3 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-[11px] font-bold text-white">
          D
        </div>
        <span className="text-[13px] font-semibold tracking-tight">DocMind</span>
      </div>

      <div className="h-4 w-px bg-border" />

      <button
        type="button"
        onClick={() => setRoute('dashboard')}
        className="no-drag flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{project ? project.name : 'No project'}</span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {project ? (
          <Button variant="ghost" size="sm" onClick={() => void reindex()} disabled={busy} title="Reindex documentation">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reindex
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => void openFolder()} disabled={busy}>
          <FolderOpen className="h-3.5 w-3.5" />
          Open folder
        </Button>
        <button
          type="button"
          onClick={() => setRoute('models')}
          className="no-drag flex items-center gap-2 rounded-full border border-border bg-elevated/70 px-3 py-1.5 text-[11.5px] transition-colors hover:border-primary/40"
          title={modelStatus.lastError ?? modelStatus.detail}
        >
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-[190px] truncate">{label}</span>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              STATE_COLOR[modelStatus.state] ?? 'bg-muted-foreground/60',
              modelStatus.state === 'generating' && 'animate-pulse'
            )}
          />
        </button>
      </div>
    </header>
  )
}

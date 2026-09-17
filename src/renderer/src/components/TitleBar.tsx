import { FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { ProviderSelector } from '@/components/ProviderSelector'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'

export function TitleBar(): JSX.Element {
  const { project, busy, reindex, openFolder, setRoute } = useAppStore()

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
        <ProviderSelector />
      </div>
    </header>
  )
}

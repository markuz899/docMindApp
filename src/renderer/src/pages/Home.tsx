import { ArrowRight, Cpu, Database, FolderOpen, Loader2, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatNumber, formatRelativeTime } from '@/lib/utils'
import { useAppStore } from '@/stores/app'

const PILLARS = [
  { icon: Database, title: 'Local database', detail: 'SQLite + FTS5 in your user folder' },
  { icon: Search, title: 'Local search', detail: 'Symbol-aware BM25 retrieval' },
  { icon: Cpu, title: 'Local AI', detail: 'GGUF via llama.cpp, or Ollama' }
]

export function Home(): JSX.Element {
  const { openFolder, busy, projects, selectProject, removeProject, indexing, error } = useAppStore()

  return (
    <div className="glow-grid flex h-full flex-col items-center justify-center overflow-y-auto px-8 py-10">
      <div className="w-full max-w-2xl text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-xl font-bold text-white shadow-2xl shadow-primary/30">
          D
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">DocMind</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">Ask your project&apos;s documentation.</p>
        <p className="text-[15px] text-muted-foreground">Everything stays local.</p>

        <Button size="lg" className="mt-7" onClick={() => void openFolder()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
          Open Documentation Folder
        </Button>

        {indexing && indexing.phase !== 'done' ? (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            {indexing.phase === 'scanning'
              ? `scanning · ${indexing.scanned} files`
              : `indexing ${indexing.done}/${indexing.total} · ${indexing.file}`}
          </p>
        ) : null}

        {error ? <p className="mt-3 text-[12px] text-destructive">{error}</p> : null}

        <div className="mt-10 grid grid-cols-3 gap-3">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon
            return (
              <div key={pillar.title} className="rounded-xl border border-border bg-surface/50 p-4 text-left">
                <Icon className="h-4 w-4 text-primary" />
                <p className="mt-2.5 text-[12.5px] font-medium">{pillar.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{pillar.detail}</p>
              </div>
            )
          })}
        </div>

        {projects.length > 0 ? (
          <div className="mt-10 text-left">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              Recent projects
            </p>
            <div className="space-y-1.5">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-surface/50 px-3 py-2.5 transition-colors hover:border-primary/40"
                >
                  <button
                    type="button"
                    onClick={() => void selectProject(project.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium">{project.name}</p>
                      <p className="truncate font-mono text-[10.5px] text-muted-foreground">{project.path}</p>
                    </div>
                    <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">
                      {formatNumber(project.stats.documents)} docs · {formatNumber(project.stats.sections)} sections ·{' '}
                      {formatRelativeTime(project.stats.lastIndexedAt)}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeProject(project.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
                    title="Forget this project"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

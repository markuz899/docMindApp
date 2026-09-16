import { FileText, Search } from 'lucide-react'
import { cn, percent } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

export function SourcesPanel(): JSX.Element {
  const sources = useChatStore((s) => s.activeSources)
  const selectedSourceId = useChatStore((s) => s.selectedSourceId)
  const selectSource = useChatStore((s) => s.selectSource)
  const openViewer = useAppStore((s) => s.openViewer)

  return (
    <aside className="flex w-[292px] shrink-0 flex-col border-l border-border bg-surface/40">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Sources</p>
        {sources.length > 0 ? (
          <span className="font-mono text-[11px] text-muted-foreground">{sources.length}</span>
        ) : null}
      </div>

      {sources.length === 0 ? (
        <EmptyState
          icon={<Search className="h-4 w-4" />}
          title="No sources yet"
          description="Ask a question and the documentation sections used to build the answer will be listed here."
        />
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
          {sources.map((source, index) => (
            <button
              key={source.sectionId}
              type="button"
              onMouseEnter={() => selectSource(source.sectionId)}
              onMouseLeave={() => selectSource(null)}
              onClick={() => openViewer({ documentId: source.documentId, sectionId: source.sectionId })}
              className={cn(
                'w-full rounded-lg border p-2.5 text-left transition-all animate-fade-in',
                selectedSourceId === source.sectionId
                  ? 'border-primary/60 bg-primary/8'
                  : 'border-border bg-elevated/40 hover:border-primary/40'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3 w-3" />
                  Source {index + 1}
                </span>
                <span className="font-mono text-[10.5px] tabular-nums text-primary">{percent(source.relevance)}</span>
              </div>

              <p className="mt-1.5 truncate text-[12.5px] font-medium">{source.heading}</p>
              <p className="truncate font-mono text-[10.5px] text-muted-foreground" title={source.relativePath}>
                {source.relativePath} · L{source.startLine}–{source.endLine}
              </p>

              <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                  style={{ width: percent(source.relevance) }}
                />
              </div>

              <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{source.excerpt}</p>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

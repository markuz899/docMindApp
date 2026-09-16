import { ChevronDown, ChevronUp, Workflow } from 'lucide-react'
import { RetrievalGraph } from '@/graph/RetrievalGraph'
import { useDragSize } from '@/lib/use-drag-size'
import { cn, formatDuration } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useGraphStore } from '@/stores/graph'

const STAGE_LABEL: Record<string, string> = {
  idle: 'idle',
  analyzing: 'analyzing query',
  searching: 'searching',
  ranking: 'ranking',
  context: 'building context',
  generating: 'generating',
  done: 'complete',
  error: 'error'
}

export function GraphPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const { stage, timings, candidates, message } = useGraphStore()
  const { size, onPointerDown, dragging } = useDragSize({ initial: 268, min: 150, max: 560, axis: 'y', invert: true })

  const open = settings.appearance.showGraph

  return (
    <section className="shrink-0 border-t border-border bg-background/40">
      {open ? (
        <div
          onMouseDown={onPointerDown}
          className={cn(
            'h-1 w-full cursor-row-resize transition-colors',
            dragging ? 'bg-primary/60' : 'bg-transparent hover:bg-primary/30'
          )}
        />
      ) : null}

      <header className="flex h-9 items-center gap-2.5 px-3.5">
        <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
          Retrieval graph
        </p>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px]',
            stage === 'error'
              ? 'bg-destructive/15 text-destructive'
              : stage === 'done' || stage === 'idle'
                ? 'bg-elevated text-muted-foreground'
                : 'bg-primary/15 text-primary'
          )}
        >
          {STAGE_LABEL[stage] ?? stage}
        </span>

        {candidates > 0 ? (
          <span className="font-mono text-[10.5px] text-muted-foreground">{candidates} candidates</span>
        ) : null}
        {timings ? (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            search {formatDuration(timings.searchMs)} · rank {formatDuration(timings.rankingMs)} · gen{' '}
            {formatDuration(timings.generationMs)}
          </span>
        ) : null}
        {message ? <span className="truncate text-[10.5px] text-warning">{message}</span> : null}

        <button
          type="button"
          onClick={() => void updateSettings({ appearance: { showGraph: !open } })}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
          title={open ? 'Hide graph' : 'Show graph'}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </header>

      {open ? (
        <div style={{ height: size }} className="border-t border-border">
          <RetrievalGraph />
        </div>
      ) : null}
    </section>
  )
}

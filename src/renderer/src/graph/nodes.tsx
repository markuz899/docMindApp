import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { cn, percent } from '@/lib/utils'

export type NodeState = 'pending' | 'active' | 'done' | 'dimmed' | 'error'

const STATE_STYLES: Record<NodeState, string> = {
  pending: 'border-border/60 bg-surface/40 text-muted-foreground',
  active: 'border-primary/70 bg-primary/10 text-foreground shadow-[0_0_24px_-6px_hsl(var(--primary))]',
  done: 'border-border bg-elevated/80 text-foreground',
  dimmed: 'border-border/40 bg-surface/30 text-muted-foreground/70',
  error: 'border-destructive/60 bg-destructive/10 text-destructive'
}

export interface StageNodeData extends Record<string, unknown> {
  label: string
  detail: string
  state: NodeState
  kicker?: string
}

export type StageNode = Node<StageNodeData, 'stage'>

export function StageNodeView({ data }: NodeProps<StageNode>): JSX.Element {
  return (
    <div
      className={cn(
        'w-[176px] rounded-xl border px-3 py-2.5 transition-all duration-300',
        STATE_STYLES[data.state],
        data.state === 'active' && 'animate-pulse-ring'
      )}
    >
      <Handle type="target" position={Position.Left} />
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] opacity-70">{data.kicker ?? 'stage'}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold tracking-tight">{data.label}</p>
      <p className="mt-0.5 truncate text-[10.5px] opacity-70">{data.detail}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export interface DocumentNodeData extends Record<string, unknown> {
  name: string
  score: number
  selected: boolean
}

export type DocumentGraphNode = Node<DocumentNodeData, 'document'>

export function DocumentNodeView({ data }: NodeProps<DocumentGraphNode>): JSX.Element {
  return (
    <div
      className={cn(
        'w-[188px] rounded-lg border px-2.5 py-2 transition-all duration-300',
        data.selected
          ? 'border-accent/70 bg-accent/10 text-foreground'
          : 'border-border/60 bg-surface/50 text-muted-foreground'
      )}
      style={{ opacity: 0.4 + data.score * 0.6 }}
    >
      <Handle type="target" position={Position.Left} />
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] opacity-60">document</p>
      <p className="mt-0.5 truncate font-mono text-[11px]">{data.name}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export interface SectionNodeData extends Record<string, unknown> {
  heading: string
  score: number
  selected: boolean
  via: 'exact' | 'fts'
  rank: number
  onOpen?: () => void
}

export type SectionGraphNode = Node<SectionNodeData, 'section'>

export function SectionNodeView({ data }: NodeProps<SectionGraphNode>): JSX.Element {
  return (
    <button
      type="button"
      onClick={data.onOpen}
      className={cn(
        'w-[216px] rounded-lg border px-2.5 py-2 text-left transition-all duration-300 hover:border-primary/70',
        data.selected
          ? 'border-primary/70 bg-primary/12 text-foreground shadow-[0_0_20px_-8px_hsl(var(--primary))]'
          : 'border-border/50 bg-surface/40 text-muted-foreground'
      )}
      style={{ opacity: data.selected ? 1 : 0.34 + data.score * 0.6 }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] opacity-60">
          #{data.rank} · {data.via}
        </span>
        <span className="font-mono text-[10px] tabular-nums opacity-80">{percent(data.score)}</span>
      </div>
      <p className="mt-0.5 truncate text-[11.5px] font-medium">{data.heading}</p>
      <Handle type="source" position={Position.Right} />
    </button>
  )
}

export const nodeTypes = {
  stage: StageNodeView,
  document: DocumentNodeView,
  section: SectionNodeView
}

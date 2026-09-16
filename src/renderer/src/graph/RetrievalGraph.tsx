import { useEffect, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGraphStore, type GraphStage } from '@/stores/graph'
import { useAppStore } from '@/stores/app'
import { formatNumber } from '@/lib/utils'
import { nodeTypes, type NodeState } from './nodes'

const COLUMN = { query: 0, search: 210, document: 430, section: 680, context: 960, ai: 1170, answer: 1380 }
const MAX_DOCUMENTS = 6
const MAX_SECTIONS = 8

const STAGE_ORDER: GraphStage[] = ['idle', 'analyzing', 'searching', 'ranking', 'context', 'generating', 'done']

function reached(current: GraphStage, target: GraphStage): boolean {
  if (current === 'error') return STAGE_ORDER.indexOf(target) <= STAGE_ORDER.indexOf('context')
  return STAGE_ORDER.indexOf(current) >= STAGE_ORDER.indexOf(target)
}

function stageState(current: GraphStage, at: GraphStage): NodeState {
  if (current === 'error' && at === 'generating') return 'error'
  if (current === at) return 'active'
  return reached(current, at) ? 'done' : 'pending'
}

function spread(count: number, gap: number): number[] {
  const total = (count - 1) * gap
  return Array.from({ length: count }, (_, index) => index * gap - total / 2)
}

function useGraphElements(): { nodes: Node[]; edges: Edge[] } {
  const state = useGraphStore()
  const openViewer = useAppStore((s) => s.openViewer)

  return useMemo(() => {
    if (state.stage === 'idle' && state.matches.length === 0) return { nodes: [], edges: [] }

    const nodes: Node[] = []
    const edges: Edge[] = []
    const flowing = (from: string, to: string, active: boolean, opacity = 1): Edge => ({
      id: `${from}->${to}`,
      source: from,
      target: to,
      animated: active,
      style: { opacity, strokeWidth: active ? 1.6 : 1 }
    })

    nodes.push({
      id: 'query',
      type: 'stage',
      position: { x: COLUMN.query, y: -32 },
      data: {
        kicker: 'query',
        label: state.analysis?.intent.replace(/_/g, ' ') ?? 'question',
        detail: state.query.length > 42 ? `${state.query.slice(0, 42)}…` : state.query || '—',
        state: stageState(state.stage, 'analyzing')
      }
    })

    nodes.push({
      id: 'search',
      type: 'stage',
      position: { x: COLUMN.search, y: -32 },
      data: {
        kicker: 'search',
        label: state.candidates > 0 ? `${state.candidates} candidates` : 'FTS5 + exact',
        detail: `${formatNumber(state.totals.sections)} sections indexed`,
        state: stageState(state.stage, 'searching')
      }
    })
    edges.push(flowing('query', 'search', state.stage === 'searching'))

    const documents = state.documents.slice(0, MAX_DOCUMENTS)
    const documentY = spread(Math.max(documents.length, 1), 74)
    documents.forEach((document, index) => {
      const id = `doc-${document.documentId}`
      nodes.push({
        id,
        type: 'document',
        position: { x: COLUMN.document, y: documentY[index] ?? 0 },
        data: { name: document.name, score: document.best, selected: document.selected }
      })
      edges.push(flowing('search', id, false, 0.35 + document.best * 0.65))
    })

    const sections = [...state.matches].sort((a, b) => b.score - a.score).slice(0, MAX_SECTIONS)
    const sectionY = spread(Math.max(sections.length, 1), 66)
    sections.forEach((section, index) => {
      const id = `sec-${section.sectionId}`
      nodes.push({
        id,
        type: 'section',
        position: { x: COLUMN.section, y: sectionY[index] ?? 0 },
        data: {
          heading: section.heading,
          score: section.score,
          selected: section.selected,
          via: section.via,
          rank: section.rank,
          onOpen: () => openViewer({ documentId: section.documentId, sectionId: section.sectionId })
        }
      })
      const documentId = `doc-${section.documentId}`
      if (nodes.some((n) => n.id === documentId)) {
        edges.push(flowing(documentId, id, false, 0.3 + section.score * 0.7))
      }
    })

    const contextReached = state.context !== null
    nodes.push({
      id: 'context',
      type: 'stage',
      position: { x: COLUMN.context, y: -32 },
      data: {
        kicker: 'context',
        label: state.context ? `${state.context.sections} sections` : 'context builder',
        detail: state.context ? `~${formatNumber(state.context.estimatedTokens)} tokens` : 'waiting',
        state: stageState(state.stage, 'context')
      }
    })
    for (const section of sections.filter((s) => s.selected)) {
      edges.push(flowing(`sec-${section.sectionId}`, 'context', state.stage === 'context', 0.9))
    }

    nodes.push({
      id: 'ai',
      type: 'stage',
      position: { x: COLUMN.ai, y: -32 },
      data: {
        kicker: 'local ai',
        label: state.stats?.model || 'local model',
        detail:
          state.stage === 'generating'
            ? 'generating…'
            : state.stats
              ? `${state.stats.tokensPerSecond.toFixed(1)} tok/s`
              : 'idle',
        state: stageState(state.stage, 'generating')
      }
    })
    edges.push(flowing('context', 'ai', state.stage === 'generating', contextReached ? 1 : 0.4))

    nodes.push({
      id: 'answer',
      type: 'stage',
      position: { x: COLUMN.answer, y: -32 },
      data: {
        kicker: 'answer',
        label: state.stage === 'done' ? 'complete' : 'answer',
        detail: state.answerChars > 0 ? `${formatNumber(state.answerChars)} chars` : '—',
        state: state.stage === 'done' ? 'done' : state.stage === 'error' ? 'error' : 'pending'
      }
    })
    edges.push(flowing('ai', 'answer', state.stage === 'generating', state.answerChars > 0 ? 1 : 0.4))

    return { nodes, edges }
  }, [state, openViewer])
}

function GraphCanvas(): JSX.Element {
  const { nodes, edges } = useGraphElements()
  const { fitView } = useReactFlow()
  const signature = `${nodes.length}-${edges.length}`

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.16, duration: 320, maxZoom: 1 })
    })
    return () => cancelAnimationFrame(frame)
  }, [signature, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.25}
      maxZoom={1.4}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnScroll={false}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="hsl(var(--border))" />
    </ReactFlow>
  )
}

export function RetrievalGraph(): JSX.Element {
  const stage = useGraphStore((s) => s.stage)
  const matches = useGraphStore((s) => s.matches.length)

  if (stage === 'idle' && matches === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        The retrieval graph appears here while a question is being answered.
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  )
}

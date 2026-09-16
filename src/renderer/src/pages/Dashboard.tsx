import { CheckCircle2, FileStack, Hash, Loader2, RefreshCw, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDuration, formatNumber, formatRelativeTime } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

const QUICK_QUESTIONS = [
  'How does authentication work?',
  'Where is GET /me documented?',
  'Which component calls the external provider?',
  'How are errors handled?'
]

export function Dashboard(): JSX.Element {
  const { project, reindex, busy, lastReport, setRoute } = useAppStore()
  const { setDraft, ask, newConversation } = useChatStore()

  if (!project) return <div className="p-6 text-[13px] text-muted-foreground">No project selected.</div>

  const cards = [
    { icon: FileStack, label: 'Documents', value: formatNumber(project.stats.documents) },
    { icon: Hash, label: 'Sections', value: formatNumber(project.stats.sections) },
    { icon: Type, label: 'Words', value: formatNumber(project.stats.words) },
    {
      icon: CheckCircle2,
      label: project.stats.lastIndexedAt ? 'Indexed' : 'Not indexed',
      value: formatRelativeTime(project.stats.lastIndexedAt)
    }
  ]

  const askQuick = (question: string): void => {
    newConversation()
    setDraft(question)
    setRoute('chat')
    void ask(question)
  }

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
            <p className="truncate font-mono text-[11.5px] text-muted-foreground">{project.path}</p>
          </div>
          <Button variant="outline" onClick={() => void reindex()} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reindex
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-4 gap-3">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <Card key={card.label} className="p-4">
                <Icon className="h-4 w-4 text-primary" />
                <p className="mt-2.5 text-xl font-semibold tabular-nums tracking-tight">{card.value}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{card.label}</p>
              </Card>
            )
          })}
        </div>

        {lastReport ? (
          <Card className="mt-3 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              Last reindex
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
              <span className="text-success">+{lastReport.added} added</span>
              <span className="text-warning">~{lastReport.changed} changed</span>
              <span className="text-destructive">−{lastReport.deleted} deleted</span>
              <span className="text-muted-foreground">{lastReport.unchanged} unchanged</span>
              <span className="ml-auto font-mono text-muted-foreground">{formatDuration(lastReport.durationMs)}</span>
            </div>
            {lastReport.errors.length > 0 ? (
              <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
                {lastReport.errors.slice(0, 5).map((issue) => (
                  <li key={issue.relativePath} className="truncate font-mono text-[10.5px] text-warning">
                    {issue.relativePath}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        <div className="mt-8">
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
            Quick questions
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {QUICK_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => askQuick(question)}
                className="rounded-lg border border-border bg-surface/50 px-3.5 py-3 text-left text-[12.5px] transition-colors hover:border-primary/50 hover:bg-elevated"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

import { AlertTriangle, FileText, Sparkles, User } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { Markdown } from '@/components/Markdown'
import { cn, formatDuration, formatNumber, percent } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

function TimingRow({ message }: { message: ChatMessage }): JSX.Element | null {
  if (!message.timings) return null
  const { timings, stats } = message
  const entries: [string, string][] = [
    ['Search', formatDuration(timings.searchMs)],
    ['Retrieval', formatDuration(timings.rankingMs + timings.contextMs)],
    ['Generation', formatDuration(timings.generationMs)]
  ]
  if (stats && stats.generatedTokens > 0) {
    entries.push(['Speed', `${stats.tokensPerSecond.toFixed(1)} tok/s`])
    entries.push(['Tokens', `${formatNumber(stats.promptTokens)} in · ${formatNumber(stats.generatedTokens)} out`])
  }

  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2.5">
      {entries.map(([label, value]) => (
        <span key={label} className="text-[10.5px] text-muted-foreground">
          {label} <span className="font-mono text-foreground/80">{value}</span>
        </span>
      ))}
    </div>
  )
}

function SourceChips({ message }: { message: ChatMessage }): JSX.Element | null {
  const openViewer = useAppStore((s) => s.openViewer)
  const selectSource = useChatStore((s) => s.selectSource)
  if (message.sources.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {message.sources.map((source, index) => (
        <button
          key={source.sectionId}
          type="button"
          onMouseEnter={() => selectSource(source.sectionId)}
          onMouseLeave={() => selectSource(null)}
          onClick={() => openViewer({ documentId: source.documentId, sectionId: source.sectionId })}
          className="flex items-center gap-1.5 rounded-md border border-border bg-elevated/60 px-2 py-1 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          title={`${source.relativePath} · ${source.headingPath}`}
        >
          <FileText className="h-3 w-3" />
          <span className="max-w-[170px] truncate">
            [{index + 1}] {source.heading}
          </span>
          <span className="font-mono text-primary">{percent(source.relevance)}</span>
        </button>
      ))}
    </div>
  )
}

export function MessageList({ messages, streaming }: { messages: ChatMessage[]; streaming: string }): JSX.Element {
  return (
    <div className="space-y-5 px-6 py-5">
      {messages.map((message) => (
        <article key={message.id} className="flex gap-3 animate-fade-in">
          <div
            className={cn(
              'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
              message.role === 'user'
                ? 'border-border bg-elevated text-muted-foreground'
                : 'border-primary/40 bg-primary/12 text-primary'
            )}
          >
            {message.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          </div>

          <div className="min-w-0 flex-1">
            {message.role === 'user' ? (
              <p className="text-[13.5px] leading-relaxed text-foreground">{message.content}</p>
            ) : (
              <>
                {message.error ? (
                  <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {message.error}
                  </p>
                ) : null}
                <Markdown>{message.content}</Markdown>
                <SourceChips message={message} />
                <TimingRow message={message} />
              </>
            )}

            {message.role === 'user' && message.analysis && message.analysis.symbols.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {message.analysis.symbols.slice(0, 6).map((symbol) => (
                  <span
                    key={symbol}
                    className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent"
                  >
                    {symbol}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}

      {streaming ? (
        <article className="flex gap-3">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/12 text-primary">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <Markdown>{streaming}</Markdown>
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
          </div>
        </article>
      ) : null}
    </div>
  )
}

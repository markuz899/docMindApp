import { useEffect, useRef } from 'react'
import { MessagesSquare } from 'lucide-react'
import { Composer } from '@/components/Composer'
import { GraphPanel } from '@/components/GraphPanel'
import { MessageList } from '@/components/MessageList'
import { EmptyState } from '@/components/ui/empty-state'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

export function Chat(): JSX.Element {
  const project = useAppStore((s) => s.project)
  const { messages, streaming, error } = useChatStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length, streaming])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !streaming ? (
          <EmptyState
            icon={<MessagesSquare className="h-4 w-4" />}
            title="Ask the documentation"
            description="Questions are answered only from the sections DocMind retrieves from this project. Mention a route, a class, a constant or an error to get a precise match."
          />
        ) : (
          <MessageList messages={messages} streaming={streaming} />
        )}
      </div>

      {error ? (
        <p className="shrink-0 border-t border-destructive/40 bg-destructive/10 px-6 py-2 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}

      <GraphPanel />
      <Composer disabled={!project} />
    </div>
  )
}

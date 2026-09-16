import { useEffect } from 'react'
import { History as HistoryIcon, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRelativeTime } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

export function History(): JSX.Element {
  const project = useAppStore((s) => s.project)
  const setRoute = useAppStore((s) => s.setRoute)
  const { conversations, loadConversations, openConversation, deleteConversation, conversationId } = useChatStore()

  useEffect(() => {
    if (project) void loadConversations(project.id)
  }, [project, loadConversations])

  if (!project) return <div className="p-6 text-[13px] text-muted-foreground">No project selected.</div>

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight">History</h1>
        <span className="font-mono text-[11px] text-muted-foreground">{conversations.length}</span>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon className="h-4 w-4" />}
          title="No conversations yet"
          description="Every question you ask is stored locally with its sources, timings and retrieval results."
        />
      ) : (
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                conversationId === conversation.id
                  ? 'border-primary/50 bg-primary/8'
                  : 'border-border bg-surface/50 hover:border-primary/40'
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  void openConversation(conversation.id)
                  setRoute('chat')
                }}
              >
                <p className="truncate text-[12.5px] font-medium">{conversation.title}</p>
                <p className="text-[10.5px] text-muted-foreground">
                  {conversation.messageCount} messages · {formatRelativeTime(conversation.updatedAt)}
                </p>
              </button>
              <button
                type="button"
                onClick={() => void deleteConversation(conversation.id)}
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
                title="Delete conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

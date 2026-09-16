import { useEffect, useRef } from 'react'
import { CornerDownLeft, Loader2, Plus, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useChatStore } from '@/stores/chat'

export function Composer({ disabled }: { disabled: boolean }): JSX.Element {
  const { draft, setDraft, ask, asking, cancel, newConversation } = useChatStore()
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(160, node.scrollHeight)}px`
  }, [draft])

  const submit = (): void => {
    const question = draft.trim()
    if (question === '' || asking || disabled) return
    void ask(question)
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface/60 p-3">
      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={newConversation}
          title="New conversation"
          disabled={asking}
          className="mb-1"
        >
          <Plus className="h-4 w-4" />
        </Button>

        <Textarea
          ref={ref}
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder={
            disabled ? 'Open a documentation folder first' : 'Ask about a route, a class, an error, a flow…'
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />

        {asking ? (
          <Button variant="outline" onClick={() => void cancel()} className="mb-1">
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Button onClick={submit} disabled={disabled || draft.trim() === ''} className="mb-1">
            {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
            Ask
          </Button>
        )}
      </div>
      <p className="mt-1.5 pl-11 text-[10.5px] text-muted-foreground/70">
        Enter to send · Shift+Enter for a new line · answers are grounded only in the indexed documentation
      </p>
    </div>
  )
}

import { create } from 'zustand'
import type { ChatMessage, ConversationSummary, PipelineEvent, Source } from '@shared/types'
import { unwrap } from './app'

interface ChatState {
  conversations: ConversationSummary[]
  conversationId: number | null
  messages: ChatMessage[]
  draft: string
  streaming: string
  asking: boolean
  error: string | null
  activeSources: Source[]
  selectedSourceId: number | null

  setDraft: (draft: string) => void
  loadConversations: (projectId: number) => Promise<void>
  openConversation: (conversationId: number) => Promise<void>
  newConversation: () => void
  deleteConversation: (conversationId: number) => Promise<void>
  ask: (question: string) => Promise<void>
  cancel: () => Promise<void>
  apply: (event: PipelineEvent) => void
  selectSource: (sectionId: number | null) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  conversationId: null,
  messages: [],
  draft: '',
  streaming: '',
  asking: false,
  error: null,
  activeSources: [],
  selectedSourceId: null,

  setDraft: (draft) => set({ draft }),

  async loadConversations(projectId) {
    try {
      set({ conversations: await window.docmind.chat.conversations(projectId).then(unwrap) })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  async openConversation(conversationId) {
    try {
      const messages = await window.docmind.chat.messages(conversationId).then(unwrap)
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
      set({
        conversationId,
        messages,
        streaming: '',
        activeSources: lastAssistant?.sources ?? [],
        selectedSourceId: null
      })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  newConversation: () =>
    set({ conversationId: null, messages: [], streaming: '', activeSources: [], selectedSourceId: null, error: null }),

  async deleteConversation(conversationId) {
    try {
      await window.docmind.chat.deleteConversation(conversationId).then(unwrap)
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        ...(state.conversationId === conversationId
          ? { conversationId: null, messages: [], activeSources: [] }
          : {})
      }))
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  async ask(question) {
    if (get().asking) return
    set({ asking: true, error: null, streaming: '', draft: '' })
    try {
      const result = await window.docmind.chat
        .ask({ conversationId: get().conversationId, question })
        .then(unwrap)

      const messages = await window.docmind.chat.messages(result.conversationId).then(unwrap)
      set({
        conversationId: result.conversationId,
        messages,
        streaming: '',
        activeSources: result.sources,
        selectedSourceId: null
      })
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ asking: false })
    }
  },

  async cancel() {
    try {
      await window.docmind.chat.cancel()
    } catch {
      /* cancelling is best effort */
    }
  },

  apply(event) {
    if (event.type === 'generation_token') {
      set((state) => ({ streaming: state.streaming + event.token }))
    } else if (event.type === 'context_selected') {
      set({ activeSources: event.sources })
    } else if (event.type === 'query_received') {
      set({ streaming: '' })
    }
  },

  selectSource: (selectedSourceId) => set({ selectedSourceId }),

  reset: () =>
    set({
      conversations: [],
      conversationId: null,
      messages: [],
      streaming: '',
      asking: false,
      error: null,
      activeSources: [],
      selectedSourceId: null
    })
}))

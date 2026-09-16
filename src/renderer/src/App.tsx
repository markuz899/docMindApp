import { useEffect } from 'react'
import { DocumentViewer } from '@/components/DocumentViewer'
import { Sidebar } from '@/components/Sidebar'
import { SourcesPanel } from '@/components/SourcesPanel'
import { TitleBar } from '@/components/TitleBar'
import { Chat } from '@/pages/Chat'
import { Dashboard } from '@/pages/Dashboard'
import { Documents } from '@/pages/Documents'
import { History } from '@/pages/History'
import { Home } from '@/pages/Home'
import { Models } from '@/pages/Models'
import { Settings } from '@/pages/Settings'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useGraphStore } from '@/stores/graph'

function Workspace(): JSX.Element {
  const route = useAppStore((s) => s.route)
  switch (route) {
    case 'dashboard':
      return <Dashboard />
    case 'documents':
      return <Documents />
    case 'history':
      return <History />
    case 'models':
      return <Models />
    case 'settings':
      return <Settings />
    default:
      return <Chat />
  }
}

export function App(): JSX.Element {
  const { ready, project, settings, bootstrap, setIndexing, setModelStatus, refreshProject } = useAppStore()
  const applyGraphEvent = useGraphStore((s) => s.apply)
  const applyChatEvent = useChatStore((s) => s.apply)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const resetChat = useChatStore((s) => s.reset)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const offPipeline = window.docmind.events.onPipeline((event) => {
      applyGraphEvent(event)
      applyChatEvent(event)
    })
    const offIndex = window.docmind.events.onIndex((progress) => {
      setIndexing(progress)
      if (progress.phase === 'done') void refreshProject()
    })
    const offModel = window.docmind.events.onModelStatus(setModelStatus)
    return () => {
      offPipeline()
      offIndex()
      offModel()
    }
  }, [applyGraphEvent, applyChatEvent, setIndexing, setModelStatus, refreshProject])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', settings.appearance.theme === 'dark')
    root.classList.toggle('light', settings.appearance.theme === 'light')
    root.dataset.accent = settings.appearance.accent
    root.style.fontSize = settings.appearance.compact ? '14px' : '15px'
  }, [settings.appearance])

  useEffect(() => {
    resetChat()
    if (project) void loadConversations(project.id)
  }, [project?.id, loadConversations, resetChat, project])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-gradient-to-br from-primary to-accent" />
      </div>
    )
  }

  if (!project) return <Home />

  return (
    <div className="flex h-full flex-col bg-background">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col border-r border-border">
          <Workspace />
        </main>
        <SourcesPanel />
        <DocumentViewer />
      </div>
    </div>
  )
}

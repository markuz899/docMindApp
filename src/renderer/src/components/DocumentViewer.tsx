import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { DocumentDetail } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/utils'
import { unwrap, useAppStore } from '@/stores/app'

export function DocumentViewer(): JSX.Element | null {
  const viewer = useAppStore((s) => s.viewer)
  const closeViewer = useAppStore((s) => s.closeViewer)
  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!viewer) return
    let cancelled = false
    setDetail(null)
    setError(null)
    setActiveSection(viewer.sectionId)

    window.docmind.documents
      .get(viewer.documentId)
      .then(unwrap)
      .then((data) => {
        if (!cancelled) setDetail(data)
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })

    return () => {
      cancelled = true
    }
  }, [viewer])

  useEffect(() => {
    if (!detail || activeSection === null) return
    const node = containerRef.current?.querySelector(`[data-section="${activeSection}"]`)
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [detail, activeSection])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeViewer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeViewer])

  if (!viewer) return null

  return (
    <div className="absolute inset-0 z-40 flex bg-background/80 backdrop-blur-sm" onClick={closeViewer}>
      <div
        className="ml-auto flex h-full w-[min(920px,78vw)] flex-col border-l border-border bg-surface shadow-2xl animate-fade-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{detail?.filename ?? 'Loading…'}</p>
            <p className="truncate font-mono text-[10.5px] text-muted-foreground">{detail?.relativePath ?? ''}</p>
          </div>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={closeViewer} aria-label="Close viewer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {error ? (
          <p className="p-6 text-[12.5px] text-destructive">{error}</p>
        ) : !detail ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <nav className="w-[230px] shrink-0 overflow-y-auto border-r border-border p-2">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                Headings
              </p>
              {detail.sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'block w-full truncate rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors',
                    activeSection === section.id
                      ? 'bg-primary/12 text-primary'
                      : 'text-muted-foreground hover:bg-elevated hover:text-foreground'
                  )}
                  title={section.headingPath}
                >
                  {section.heading}
                </button>
              ))}
            </nav>

            <div ref={containerRef} className="flex-1 overflow-y-auto p-5">
              {detail.sections.map((section) => (
                <section
                  key={section.id}
                  data-section={section.id}
                  className={cn(
                    'mb-3 rounded-lg border p-4 transition-colors',
                    activeSection === section.id
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-transparent hover:border-border'
                  )}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <p className="truncate text-[12.5px] font-semibold">{section.headingPath}</p>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      L{section.startLine}–{section.endLine}
                    </span>
                  </div>
                  <Markdown>{section.content}</Markdown>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

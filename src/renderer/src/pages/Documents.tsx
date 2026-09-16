import { useEffect, useState } from 'react'
import { BookText, Loader2 } from 'lucide-react'
import type { DocumentSummary } from '@shared/types'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { formatNumber, formatRelativeTime } from '@/lib/utils'
import { unwrap, useAppStore } from '@/stores/app'

export function Documents(): JSX.Element {
  const project = useAppStore((s) => s.project)
  const openViewer = useAppStore((s) => s.openViewer)
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    setDocuments(null)
    window.docmind.documents
      .list(project.id)
      .then(unwrap)
      .then(setDocuments)
      .catch((cause: Error) => setError(cause.message))
  }, [project])

  if (!project) return <div className="p-6 text-[13px] text-muted-foreground">No project selected.</div>
  if (error) return <div className="p-6 text-[13px] text-destructive">{error}</div>
  if (!documents) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const needle = filter.trim().toLowerCase()
  const visible = needle === '' ? documents : documents.filter((d) => d.relativePath.toLowerCase().includes(needle))

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Documents</h1>
        <span className="font-mono text-[11px] text-muted-foreground">{formatNumber(documents.length)}</span>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by path…"
          className="ml-auto max-w-[280px]"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<BookText className="h-4 w-4" />}
          title="No documents match"
          description="Adjust the filter, or reindex the folder if files were added recently."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <table className="w-full border-separate border-spacing-y-1 text-[12.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                <th className="px-3 pb-1 text-left font-medium">Path</th>
                <th className="px-3 pb-1 text-right font-medium">Sections</th>
                <th className="px-3 pb-1 text-right font-medium">Words</th>
                <th className="px-3 pb-1 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((document) => (
                <tr
                  key={document.id}
                  onClick={() => openViewer({ documentId: document.id, sectionId: null })}
                  className="cursor-pointer rounded-lg [&>td]:bg-surface/50 [&>td]:transition-colors hover:[&>td]:bg-elevated"
                >
                  <td className="rounded-l-lg px-3 py-2">
                    <span className="font-mono text-[11.5px]">{document.relativePath}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {document.sections}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {formatNumber(document.words)}
                  </td>
                  <td className="rounded-r-lg px-3 py-2 text-right text-muted-foreground">
                    {formatRelativeTime(document.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

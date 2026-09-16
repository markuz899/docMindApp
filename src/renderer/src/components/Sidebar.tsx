import { BookText, Cpu, LayoutDashboard, MessagesSquare, Settings2, History } from 'lucide-react'
import { cn, formatNumber, formatRelativeTime } from '@/lib/utils'
import { useAppStore, type Route } from '@/stores/app'

const ITEMS: { route: Route; label: string; icon: typeof BookText }[] = [
  { route: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { route: 'chat', label: 'Ask', icon: MessagesSquare },
  { route: 'documents', label: 'Documents', icon: BookText },
  { route: 'history', label: 'History', icon: History },
  { route: 'models', label: 'Model', icon: Cpu },
  { route: 'settings', label: 'Settings', icon: Settings2 }
]

export function Sidebar(): JSX.Element {
  const { route, setRoute, project, indexing } = useAppStore()

  return (
    <aside className="flex w-[212px] shrink-0 flex-col border-r border-border bg-surface/40">
      <div className="px-3 py-3">
        <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Project</p>
        <p className="truncate px-2 pt-1 text-[13px] font-medium">{project?.name ?? 'None'}</p>
        {project ? (
          <p className="truncate px-2 pt-0.5 font-mono text-[10.5px] text-muted-foreground/70" title={project.path}>
            {project.path}
          </p>
        ) : null}
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
        {ITEMS.map((item) => {
          const Icon = item.icon
          const active = route === item.route
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => setRoute(item.route)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors',
                active
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-elevated hover:text-foreground'
              )}
            >
              <Icon className="h-[15px] w-[15px]" />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-border p-3">
        {indexing && indexing.phase !== 'done' ? (
          <div className="rounded-lg border border-primary/30 bg-primary/8 px-2.5 py-2">
            <p className="text-[11px] font-medium text-primary">
              {indexing.phase === 'scanning' ? 'Scanning…' : 'Indexing…'}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {indexing.phase === 'scanning'
                ? `${indexing.scanned} files`
                : `${indexing.done}/${indexing.total} · ${indexing.file}`}
            </p>
          </div>
        ) : null}

        {project ? (
          <dl className="space-y-1 text-[11px] text-muted-foreground">
            <div className="flex justify-between">
              <dt>Documents</dt>
              <dd className="font-mono text-foreground">{formatNumber(project.stats.documents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Sections</dt>
              <dd className="font-mono text-foreground">{formatNumber(project.stats.sections)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Words</dt>
              <dd className="font-mono text-foreground">{formatNumber(project.stats.words)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Indexed</dt>
              <dd className="text-foreground">{formatRelativeTime(project.stats.lastIndexedAt)}</dd>
            </div>
          </dl>
        ) : null}

        <div className="flex flex-wrap gap-1 pt-1">
          {['Local database', 'Local search', 'Local AI'].map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-border bg-elevated/60 px-2 py-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    </aside>
  )
}

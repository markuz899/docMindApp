import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-elevated text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

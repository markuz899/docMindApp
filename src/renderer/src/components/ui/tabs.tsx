import { cn } from '@/lib/utils'

export interface TabItem<T extends string> {
  value: T
  label: string
}

interface TabsProps<T extends string> {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

export function Tabs<T extends string>({ items, value, onChange, className }: TabsProps<T>): JSX.Element {
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-lg border border-border bg-elevated/50 p-1', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            'no-drag rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
            value === item.value
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

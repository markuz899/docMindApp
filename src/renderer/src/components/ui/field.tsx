import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FieldProps {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}

export function Field({ label, hint, className, children }: FieldProps): JSX.Element {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-muted-foreground/70">{hint}</span> : null}
    </label>
  )
}

interface SliderFieldProps {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  format?: (value: number) => string
  onChange: (value: number) => void
}

export function SliderField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  format,
  onChange
}: SliderFieldProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="font-mono text-[12px] text-foreground">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="no-drag h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))]"
      />
      {hint ? <span className="text-[11px] leading-snug text-muted-foreground/70">{hint}</span> : null}
    </div>
  )
}

interface ToggleFieldProps {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function ToggleField({ label, hint, checked, onChange }: ToggleFieldProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="no-drag flex items-center justify-between gap-4 rounded-lg border border-border bg-elevated/40 px-3 py-2.5 text-left transition-colors hover:border-primary/40"
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium">{label}</span>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          )}
        />
      </span>
    </button>
  )
}

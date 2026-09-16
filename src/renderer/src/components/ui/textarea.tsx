import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'no-drag w-full resize-none rounded-lg border border-border bg-input/50 px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

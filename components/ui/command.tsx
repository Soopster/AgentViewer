'use client'

import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type CommandDialogProps = React.PropsWithChildren<{
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}>

const CommandDialog = React.forwardRef<HTMLDivElement, CommandDialogProps>(
  ({ open, onOpenChange, className, children }, ref) => {
    React.useEffect(() => {
      if (!open) return
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onOpenChange(false)
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [onOpenChange, open])

    if (!open) return null

    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 py-16 backdrop-blur-[2px]"
        onMouseDown={() => onOpenChange(false)}
        role="presentation"
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={cn(
            'w-full max-w-[760px] overflow-hidden rounded-[18px] border border-border bg-[var(--surface)] text-popover-foreground shadow-[0_24px_80px_rgba(0,0,0,0.45)]',
            className,
          )}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </div>
    )
  },
)
CommandDialog.displayName = 'CommandDialog'

const Command = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="command"
      className={cn('flex h-full w-full flex-col bg-[var(--surface)] text-[var(--text)]', className)}
      {...props}
    />
  ),
)
Command.displayName = 'Command'

const CommandInput = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  ({ className, ...props }, ref) => (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <Input
        ref={ref}
        className={cn(
          'h-10 border-0 bg-[var(--surface-2)] px-3 text-[13px] text-[var(--text)] shadow-none placeholder:text-[var(--text-3)] focus-visible:ring-1 focus-visible:ring-[var(--cyan)] focus-visible:ring-offset-0',
          className,
        )}
        {...props}
      />
    </div>
  ),
)
CommandInput.displayName = 'CommandInput'

const CommandList = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="command-list"
      className={cn('max-h-[460px] overflow-y-auto px-2.5 py-2', className)}
      {...props}
    />
  ),
)
CommandList.displayName = 'CommandList'

const CommandEmpty = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="command-empty"
      className={cn(
        'px-3 py-8 text-center font-mono text-[12px] tracking-[0.04em] text-[var(--text-3)]',
        className,
      )}
      {...props}
    />
  ),
)
CommandEmpty.displayName = 'CommandEmpty'

const CommandGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & { heading?: string }
>(({ className, heading, children, ...props }, ref) => (
  <div ref={ref} data-slot="command-group" className={cn('mb-3', className)} {...props}>
    {heading ? (
      <div className="px-3 pb-1.5 pt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-3)]">
        {heading}
      </div>
    ) : null}
    <div className="grid gap-0.5">{children}</div>
  </div>
))
CommandGroup.displayName = 'CommandGroup'

const CommandItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ className, active, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    data-slot="command-item"
    data-active={active ? 'true' : 'false'}
    className={cn(
      'flex w-full items-center gap-3 rounded-[10px] border border-transparent px-3 py-2 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cyan)]',
      active && 'border-[rgba(56,217,245,0.22)] bg-[var(--surface-2)]',
      className,
    )}
    {...props}
  />
))
CommandItem.displayName = 'CommandItem'

const CommandSeparator = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="command-separator"
      className={cn('my-2.5 h-px bg-[var(--border)]', className)}
      {...props}
    />
  ),
)
CommandSeparator.displayName = 'CommandSeparator'

const CommandShortcut = React.forwardRef<HTMLSpanElement, React.ComponentProps<'span'>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="command-shortcut"
      className={cn('ml-auto font-mono text-[10px] tracking-[0.05em] text-[var(--text-3)]', className)}
      {...props}
    />
  ),
)
CommandShortcut.displayName = 'CommandShortcut'

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}

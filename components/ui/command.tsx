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
        className="fixed inset-0 z-50 flex items-start justify-center bg-[color-mix(in_srgb,var(--bg)_72%,rgba(0,0,0,0.55))] backdrop-blur-[3px]"
        style={{ padding: '28px 32px 32px' }}
        onMouseDown={() => onOpenChange(false)}
        role="presentation"
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={cn(
            'flex w-full max-w-[760px] overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-[0_24px_80px_var(--shadow,rgba(0,0,0,0.24))]',
            className,
          )}
          style={{ maxHeight: 'calc(100vh - 60px)' }}
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
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="command"
      className={cn('flex min-h-0 w-full flex-col bg-[var(--surface)] text-[var(--text)]', className)}
      style={{ gap: 10, padding: 12, ...style }}
      {...props}
    />
  ),
)
Command.displayName = 'Command'

const CommandInput = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  ({ className, style, ...props }, ref) => (
    <div
      className="shrink-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]"
      style={{ padding: 10 }}
    >
      <Input
        ref={ref}
        className={cn(
          'h-11 border-0 bg-[var(--surface-2)] px-4 text-[14px] text-[var(--text)] shadow-none placeholder:text-[var(--text-3)] focus-visible:ring-1 focus-visible:ring-[var(--cyan)] focus-visible:ring-offset-0',
          className,
        )}
        style={{ padding: '0 14px', ...style }}
        {...props}
      />
    </div>
  ),
)
CommandInput.displayName = 'CommandInput'

const CommandList = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="command-list"
      className={cn('min-h-0 flex-1 overflow-y-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)]', className)}
      style={{ padding: 10, ...style }}
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
>(({ className, heading, children, style, ...props }, ref) => (
  <div ref={ref} data-slot="command-group" className={cn('mb-2.5', className)} style={style} {...props}>
    {heading ? (
      <div
        className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-3)]"
        style={{ padding: '1px 8px 6px' }}
      >
        {heading}
      </div>
    ) : null}
    <div className="grid" style={{ gap: 2 }}>{children}</div>
  </div>
))
CommandGroup.displayName = 'CommandGroup'

const CommandItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ className, active, style, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    data-slot="command-item"
    data-active={active ? 'true' : 'false'}
    className={cn(
      'flex w-full items-center gap-3 rounded-[10px] border border-transparent text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cyan)]',
      active && 'border-[color-mix(in_srgb,var(--cyan)_34%,var(--border))] bg-[var(--surface-2)] shadow-[inset_2px_0_0_var(--cyan)]',
      className,
    )}
    style={{ padding: '7px 10px', ...style }}
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

'use client'

import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type CommandDialogProps = React.PropsWithChildren<{
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  centered?: boolean
  style?: React.CSSProperties
  ref?: React.Ref<HTMLDivElement>
}>

function CommandDialog({ ref, open, onOpenChange, className, centered = false, style, children }: CommandDialogProps) {
  const isOpenRef = React.useRef(open)

  React.useEffect(() => {
    isOpenRef.current = open
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenChange, open])

  const handleBackdropClick = React.useCallback(() => {
    if (isOpenRef.current) {
      onOpenChange(false)
    }
  }, [onOpenChange])

  if (!open) return null

  return (
    <div
      className={cn('fixed inset-0 z-50 flex justify-center', centered ? 'items-center' : 'items-start')}
      style={{
        padding: '28px 32px 32px',
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'none'
      }}
      onMouseDown={handleBackdropClick}
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
        style={{ maxHeight: 'calc(100vh - 60px)', ...style }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
CommandDialog.displayName = 'CommandDialog'

function Command({ ref, className, style, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      ref={ref}
      data-slot="command"
      className={cn('flex min-h-0 w-full flex-col bg-[var(--surface)] text-[var(--text)]', className)}
      style={{ gap: 10, padding: 12, ...style }}
      {...props}
    />
  )
}
Command.displayName = 'Command'

function CommandInput({ ref, className, style, ...props }: React.ComponentProps<typeof Input>) {
  return (
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
  )
}
CommandInput.displayName = 'CommandInput'

function CommandList({ ref, className, style, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      ref={ref}
      data-slot="command-list"
      className={cn('min-h-0 flex-1 overflow-y-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)]', className)}
      style={{ padding: 10, ...style }}
      {...props}
    />
  )
}
CommandList.displayName = 'CommandList'

function CommandEmpty({ ref, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      ref={ref}
      data-slot="command-empty"
      className={cn(
        'px-3 py-8 text-center font-mono text-[12px] tracking-[0.04em] text-[var(--text-3)]',
        className,
      )}
      {...props}
    />
  )
}
CommandEmpty.displayName = 'CommandEmpty'

function CommandGroup({
  ref,
  className,
  heading,
  children,
  style,
  ...props
}: React.ComponentProps<'div'> & { heading?: string }) {
  return (
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
  )
}
CommandGroup.displayName = 'CommandGroup'

function CommandItem({
  ref,
  className,
  active,
  style,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
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
  )
}
CommandItem.displayName = 'CommandItem'

function CommandSeparator({ ref, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      ref={ref}
      data-slot="command-separator"
      className={cn('my-2.5 h-px bg-[var(--border)]', className)}
      {...props}
    />
  )
}
CommandSeparator.displayName = 'CommandSeparator'

function CommandShortcut({ ref, className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      ref={ref}
      data-slot="command-shortcut"
      className={cn('ml-auto font-mono text-[10px] tracking-[0.05em] text-[var(--text-3)]', className)}
      {...props}
    />
  )
}
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

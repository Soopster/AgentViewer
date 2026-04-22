import * as React from "react"

import { cn } from "@/lib/utils"

const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextValue = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  toggleSidebar: () => void
  width: number
  setWidth: (width: number) => void
  applyWidth: (width: number) => void
  sidebarRef: React.MutableRefObject<HTMLElement | null>
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function SidebarProvider({
  defaultOpen = true,
  children,
  className,
  ...props
}: React.PropsWithChildren<{
  defaultOpen?: boolean
  className?: string
} & React.HTMLAttributes<HTMLDivElement>>) {
  const [open, setOpen] = React.useState(defaultOpen)
  const [width, setWidth] = React.useState(290)
  const sidebarRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem("agentViewer:sidebarOpen")
      if (stored == null) return
      setOpen(stored === "1")
    } catch {
      // ignore storage failures
    }
  }, [])

  React.useEffect(() => {
    try {
      window.localStorage.setItem("agentViewer:sidebarOpen", open ? "1" : "0")
    } catch {
      // ignore storage failures
    }
  }, [open])

  React.useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem("agentViewer:sidebarWidth"))
      if (Number.isFinite(stored) && stored >= 220 && stored <= 640) {
        setWidth(stored)
      }
    } catch {
      // ignore storage failures
    }
  }, [])

  React.useEffect(() => {
    try {
      window.localStorage.setItem("agentViewer:sidebarWidth", String(width))
    } catch {
      // ignore storage failures
    }
  }, [width])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== SIDEBAR_KEYBOARD_SHORTCUT) return
      event.preventDefault()
      setOpen((current) => !current)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const value = React.useMemo(
    () => ({
      state: open ? ("expanded" as const) : ("collapsed" as const),
      open,
      setOpen,
      toggleSidebar: () => setOpen((current) => !current),
      width,
      setWidth,
      sidebarRef,
      applyWidth: (nextWidth: number) => {
        sidebarRef.current?.style.setProperty("--sidebar-width", `${nextWidth}px`)
      },
    }),
    [open, width]
  )

  return (
    <SidebarContext.Provider value={value}>
      <div className={cn("min-h-screen", className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}

function Sidebar({
  className,
  side = "left",
  variant = "sidebar",
  collapsible = "icon",
  children,
  ...props
}: React.PropsWithChildren<{
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
  className?: string
} & React.HTMLAttributes<HTMLElement>>) {
  const { state, width, sidebarRef } = useSidebar()
  const { style, ...rest } = props
  const isCollapsed = collapsible !== "none" && state === "collapsed"
  return (
    <aside
      ref={sidebarRef}
      data-slot="sidebar"
      data-side={side}
      data-variant={variant}
      data-collapsible={collapsible}
      data-state={state}
      className={cn(
        "relative flex h-screen shrink-0 flex-col overflow-hidden border-border bg-[var(--surface)] transition-[width,min-width] duration-200 ease-linear",
        side === "left" ? "border-r" : "border-l",
        variant === "inset" && "m-0 border-r-0",
        variant === "floating" && "m-2 rounded-xl border shadow-sm",
        isCollapsed ? "w-[92px] min-w-[92px]" : "w-[var(--sidebar-width,18rem)] min-w-[var(--sidebar-width,18rem)]",
        className
      )}
      style={
        {
          "--sidebar-width": `${width}px`,
          ...style,
        } as React.CSSProperties
      }
      {...rest}
    >
      {children}
    </aside>
  )
}

function SidebarInset({
  className,
  children,
  ...props
}: React.PropsWithChildren<React.HTMLAttributes<HTMLElement>>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg)]", className)}
      {...props}
    >
      {children}
    </main>
  )
}

function SidebarHeader({
  className,
  children,
  ...props
}: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div data-slot="sidebar-header" className={cn("shrink-0", className)} {...props}>
      {children}
    </div>
  )
}

function SidebarContent({
  className,
  children,
  ...props
}: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("min-h-0 flex-1 overflow-auto", className)}
      {...props}
    >
      {children}
    </div>
  )
}

function SidebarFooter({
  className,
  children,
  ...props
}: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div data-slot="sidebar-footer" className={cn("shrink-0", className)} {...props}>
      {children}
    </div>
  )
}

function SidebarTrigger({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { state, toggleSidebar } = useSidebar()
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      aria-label={state === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
      aria-pressed={state === "collapsed"}
      onClick={toggleSidebar}
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-border bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-2)] shadow-xs transition-colors hover:bg-[var(--surface-3)]",
        className
      )}
      {...props}
    >
      {children ?? (state === "expanded" ? "‹" : "›")}
    </button>
  )
}

function SidebarRail({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-rail"
      className={cn(
        "absolute inset-y-0 right-0 z-10 w-3 cursor-col-resize bg-transparent after:absolute after:inset-y-0 after:right-1/2 after:w-px after:bg-border/80 hover:after:bg-[var(--violet)]",
        className
      )}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="sidebar-separator" className={cn("h-px bg-border", className)} {...props} />
}

function SidebarGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="sidebar-group" className={cn("grid gap-2 px-4 py-3", className)} {...props} />
  )
}

function SidebarGroupLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "flex h-5 items-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-3)]",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-slot="sidebar-group-action"
      className={cn(
        "inline-flex h-6 items-center justify-center rounded-md border border-border bg-[var(--surface-2)] px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-3)]",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="sidebar-group-content" className={cn("grid gap-2", className)} {...props} />
}

function SidebarMenu({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  return <ul data-slot="sidebar-menu" className={cn("grid gap-1", className)} {...props} />
}

function SidebarMenuItem({
  className,
  ...props
}: React.LiHTMLAttributes<HTMLLIElement>) {
  return <li data-slot="sidebar-menu-item" className={cn("list-none", className)} {...props} />
}

function SidebarMenuButton({
  className,
  isActive,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean }) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      data-active={isActive ? "true" : "false"}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
        isActive && "bg-[var(--surface-2)] text-[var(--text)]",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarProvider,
  SidebarRail,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}

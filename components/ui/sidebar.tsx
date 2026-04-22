import * as React from "react"

import { cn } from "@/lib/utils"

type SidebarContextValue = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  toggleSidebar: () => void
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
  const [open, setOpen] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return defaultOpen
    const stored = window.localStorage.getItem("agentViewer:sidebarOpen")
    if (stored == null) return defaultOpen
    return stored === "1"
  })

  React.useEffect(() => {
    try {
      window.localStorage.setItem("agentViewer:sidebarOpen", open ? "1" : "0")
    } catch {
      // ignore storage failures
    }
  }, [open])

  const value = React.useMemo(
    () => ({
      state: open ? ("expanded" as const) : ("collapsed" as const),
      open,
      setOpen,
      toggleSidebar: () => setOpen((current) => !current),
    }),
    [open]
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
  children,
  ...props
}: React.PropsWithChildren<{
  side?: "left" | "right"
  className?: string
} & React.HTMLAttributes<HTMLElement>>) {
  return (
    <aside
      data-slot="sidebar"
      data-side={side}
      className={cn("flex h-screen shrink-0 flex-col overflow-hidden", className)}
      {...props}
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
      className={cn("flex min-w-0 flex-1 flex-col overflow-hidden", className)}
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
      className={cn("absolute inset-y-0 right-0 w-1 cursor-col-resize bg-transparent", className)}
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
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
}

"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

const COLORS = [
  "#5eead4",
  "#8b80f0",
  "#f472b6",
  "#4ade80",
  "#fbbf24",
  "#f87171",
  "#06b6d4",
  "#ec4899",
]
const NEUTRAL_COLOR = "hsl(var(--text-3))"

type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: Record<string, string> }
    | { color?: string; theme?: Record<string, string> }
  )
}

const ChartContext = React.createContext<ChartConfig | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }
  return context
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    config: ChartConfig
    children: React.ReactNode
  }
>(({ id, className, children, config, ...props }, ref) => (
  <ChartContext.Provider value={config}>
    <div
      ref={ref}
      className={cn(
        "flex aspect-auto h-80 w-full items-center justify-center text-xs",
        className
      )}
      {...props}
    >
      <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  </ChartContext.Provider>
))
ChartContainer.displayName = "ChartContainer"

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([_, config]) => config.theme || typeof config.color === "string"
  )

  if (colorConfig.length === 0) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: [
          `#${id} {`,
          colorConfig
            .map(([key, itemConfig]) => {
              const color =
                itemConfig.theme?.light ||
                itemConfig.color

              return color ? `--color-${key}: ${color};` : null
            })
            .join("\n"),
          `}`,
        ].join("\n"),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  any
>(({ active, payload, label }: any, ref) => {
  if (!active || !payload) return null

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-neutral-200/80 bg-white px-2.5 py-1.5 text-sm shadow-md",
        !active && "hidden"
      )}
    >
      <div className="grid gap-2">
        {label != null && (
          <div className="flex items-center justify-between gap-8">
            <span className="text-muted-foreground">{label}</span>
          </div>
        )}
        {payload.length > 0 && (
          <div className="grid gap-1.5">
            {payload.map((item: any) => (
              <div
                key={item.dataKey}
                className="flex items-center gap-2"
              >
                <div
                  className="shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                    width: 12,
                    height: 12,
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {item.name}
                </span>
                <div className="font-mono font-medium text-foreground">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
ChartTooltipContent.displayName = "ChartTooltipContent"

export {
  ChartContainer,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
  useChart,
}

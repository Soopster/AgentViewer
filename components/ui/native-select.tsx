import * as React from "react"

import { cn } from "@/lib/utils"

export const nativeSelectBaseClassName =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-[11px] text-foreground shadow-xs outline-none transition-[color,box-shadow,border-color] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background [font-family:'IBM_Plex_Mono',monospace]"

function NativeSelect({ ref, className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      ref={ref}
      data-slot="native-select"
      className={cn(nativeSelectBaseClassName, className)}
      {...props}
    >
      {children}
    </select>
  )
}
NativeSelect.displayName = "NativeSelect"

function NativeSelectOption({ ref, children, ...props }: React.ComponentProps<"option">) {
  return (
    <option ref={ref} data-slot="native-select-option" {...props}>
      {children}
    </option>
  )
}
NativeSelectOption.displayName = "NativeSelectOption"

function NativeSelectOptGroup({ ref, children, ...props }: React.ComponentProps<"optgroup">) {
  return (
    <optgroup ref={ref} data-slot="native-select-optgroup" {...props}>
      {children}
    </optgroup>
  )
}
NativeSelectOptGroup.displayName = "NativeSelectOptGroup"

export { NativeSelect, NativeSelectOption, NativeSelectOptGroup }

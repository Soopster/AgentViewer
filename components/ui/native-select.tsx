import * as React from "react"

import { cn } from "@/lib/utils"

export const nativeSelectBaseClassName =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-[11px] text-foreground shadow-xs outline-none transition-[color,box-shadow,border-color] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background [font-family:'IBM_Plex_Mono',monospace]"

const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
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
})
NativeSelect.displayName = "NativeSelect"

const NativeSelectOption = React.forwardRef<
  HTMLOptionElement,
  React.OptionHTMLAttributes<HTMLOptionElement>
>(({ children, ...props }, ref) => {
  return (
    <option ref={ref} data-slot="native-select-option" {...props}>
      {children}
    </option>
  )
})
NativeSelectOption.displayName = "NativeSelectOption"

const NativeSelectOptGroup = React.forwardRef<
  HTMLOptGroupElement,
  React.OptgroupHTMLAttributes<HTMLOptGroupElement>
>(({ children, ...props }, ref) => {
  return (
    <optgroup ref={ref} data-slot="native-select-optgroup" {...props}>
      {children}
    </optgroup>
  )
})
NativeSelectOptGroup.displayName = "NativeSelectOptGroup"

export { NativeSelect, NativeSelectOption, NativeSelectOptGroup }

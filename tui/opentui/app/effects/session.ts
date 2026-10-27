/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import { tabStripActivity } from '../../tabStrip'
import React from 'react'
import { type TabSelectOption, type TabSelectRenderable } from '@opentui/core'
import { TAB_SPINNER_FRAMES, TAB_SPINNER_INTERVAL_MS } from '../chrome'

export type OptionsEffectContext = {
  tabSelectRef: React.RefObject<TabSelectRenderable | null>
  runningTabKeys: Set<string>
  tabOptions: TabSelectOption[]
  tabWidth: number
}

export function runOptionsEffect(ctx: OptionsEffectContext) {
  const {
    tabSelectRef, runningTabKeys, tabOptions, tabWidth,
  } = ctx
  const instance = tabSelectRef.current
  if (!instance) return undefined
  if (runningTabKeys.size === 0) {
    // Nothing is running: hand back exactly what React rendered, or the last
    // frame drawn stays frozen on a tab that has finished.
    instance.setOptions(tabOptions)
    return undefined
  }
  let frame = 0
  const paint = () => {
    const target = tabSelectRef.current
    if (!target) return
    target.setOptions(tabOptions.map((option) => (
      option.value != null && runningTabKeys.has(option.value as string)
        ? { ...option, name: tabStripActivity(option.name, tabWidth, TAB_SPINNER_FRAMES[frame % TAB_SPINNER_FRAMES.length]) }
        : option
    )))
  }
  paint()
  const id = setInterval(() => {
    frame += 1
    paint()
  }, TAB_SPINNER_INTERVAL_MS)
  return () => clearInterval(id)
}

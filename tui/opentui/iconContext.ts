import { createContext, useContext } from 'react'
import type { ViewIconSet } from '../viewSpec'
import { tuiIcon, type NERD_FONT_ICONS } from './icons'

export const TuiIconSetContext = createContext<ViewIconSet>('standard')
export const TuiPopupIconSetContext = createContext<ViewIconSet>('standard')

/** Current icon set for shared controls and plugin content. */
export function useTuiIconSet(): ViewIconSet {
  return useContext(TuiIconSetContext)
}

export function useTuiPopupIconSet(): ViewIconSet {
  return useContext(TuiPopupIconSetContext)
}

export function useTuiPopupTitle(label: string, icon: keyof typeof NERD_FONT_ICONS): string {
  const glyph = tuiIcon(useTuiPopupIconSet(), icon, '')
  return glyph ? ` ${glyph} ${label} ` : ` ${label} `
}

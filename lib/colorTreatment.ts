// Flat vs gradient color treatment — a document-level preference (like
// theme/render-font) rather than a MessageView-local one, since it's
// consumed entirely in CSS via `[data-color-treatment="flat"]` overrides
// in app/globals.css. Mirrors lib/renderFonts.ts's pattern exactly.

export type ColorTreatment = 'gradient' | 'flat'

export const DEFAULT_COLOR_TREATMENT: ColorTreatment = 'gradient'
export const COLOR_TREATMENT_STORAGE_KEY = 'agentViewer:colorTreatment'
export const COLOR_TREATMENTS: readonly ColorTreatment[] = ['gradient', 'flat']

const colorTreatmentListeners = new Set<() => void>()

export function isColorTreatment(value: string | null | undefined): value is ColorTreatment {
  return value === 'gradient' || value === 'flat'
}

export function getCurrentColorTreatment(): ColorTreatment {
  if (typeof document === 'undefined') return DEFAULT_COLOR_TREATMENT
  const current = document.documentElement.dataset.colorTreatment
  return isColorTreatment(current) ? current : DEFAULT_COLOR_TREATMENT
}

export function subscribeColorTreatment(listener: () => void): () => void {
  colorTreatmentListeners.add(listener)
  return () => colorTreatmentListeners.delete(listener)
}

export function applyColorTreatment(treatment: ColorTreatment): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.colorTreatment = treatment
  localStorage.setItem(COLOR_TREATMENT_STORAGE_KEY, treatment)
  for (const listener of colorTreatmentListeners) listener()
}

/** The themes the host itself ships, so the app always has a look; every other theme is contributed by a plugin (plugins/themes-*). */
export type BuiltinTheme = 'dark' | 'light'

/** Any registered theme id: a built-in or one a plugin/mod registered at runtime. */
export type Theme = string

export type ThemeCategory = 'dark' | 'light'
export type ThemeMeta = { category: ThemeCategory; icon: string; label: string }

const BUILTIN_THEME_META: Record<BuiltinTheme, ThemeMeta> = {
  light: { category: 'light', icon: '☀', label: 'Light' },
  dark:  { category: 'dark',  icon: '☾', label: 'Dark' },
}

/**
 * The live registry. These containers are mutated in place by `registerTheme`
 * so every importer's reference stays current; read them at call time.
 */
export const THEME_META: Record<Theme, ThemeMeta> = { ...BUILTIN_THEME_META }
export const THEMES: Theme[] = Object.keys(BUILTIN_THEME_META)
export const THEME_GROUPS: Array<{ category: ThemeCategory; label: string; themes: Theme[] }> = [
  { category: 'light', label: 'Light', themes: [] },
  { category: 'dark', label: 'Dark', themes: [] },
]

const BUILTIN_IDS: ReadonlySet<string> = new Set(THEMES)
export const THEME_STYLE_ELEMENT_PREFIX = 'agent-viewer-theme-'
const STYLE_ELEMENT_PREFIX = THEME_STYLE_ELEMENT_PREFIX

/** The stylesheet text for one theme; the server renders it before first paint and registerTheme writes the same text. */
export function themeStyleText(id: string, css: string, rules?: string): string {
  return `[data-theme="${id}"] { ${css} }${rules ? `\n${rules}` : ''}`
}

function rebuildThemeGroups() {
  for (const group of THEME_GROUPS) {
    group.themes = THEMES
      .filter((theme) => THEME_META[theme].category === group.category)
      .sort((a, b) => THEME_META[a].label.localeCompare(THEME_META[b].label) || a.localeCompare(b))
  }
  // THEMES follows the menu, so cycling and listing never depend on which plugin registered first.
  THEMES.splice(0, THEMES.length, ...THEME_GROUPS.flatMap(group => group.themes))
}
rebuildThemeGroups()

export function isKnownTheme(value: unknown): value is Theme {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEME_META, value)
}

export type ThemeRegistration = ThemeMeta & {
  id: string
  /** Declarations for the theme's CSS variables, e.g. `--bg: #101010; --fg: #eee;`. */
  css: string
  /** Further rules for this theme, written out in full. Bundled plugins only: it is refused without `trusted`. */
  rules?: string
  trusted?: boolean
}

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/

/**
 * Registers a theme at runtime. Built-in ids cannot be replaced. The CSS is
 * scoped to `[data-theme="<id>"]` by this function, so a registration cannot
 * restyle anything outside its own theme. Returns an unregister function.
 */
export function registerTheme(theme: ThemeRegistration): () => void {
  if (!THEME_ID_PATTERN.test(theme.id)) throw new Error(`Invalid theme id "${theme.id}"`)
  if (isBuiltinTheme(theme.id)) throw new Error(`Theme "${theme.id}" is built in and cannot be replaced`)
  if (/[{}<>]/.test(theme.css)) throw new Error(`Theme "${theme.id}" css must be bare declarations`)
  if (theme.rules && !theme.trusted) throw new Error(`Theme "${theme.id}": only a bundled plugin may add rules`)
  const known = isKnownTheme(theme.id)
  THEME_META[theme.id] = { category: theme.category, icon: theme.icon, label: theme.label }
  if (!known) THEMES.push(theme.id)
  rebuildThemeGroups()
  if (typeof document !== 'undefined') {
    const elementId = STYLE_ELEMENT_PREFIX + theme.id
    const style = document.getElementById(elementId) ?? document.createElement('style')
    style.id = elementId
    style.textContent = themeStyleText(theme.id, theme.css, theme.rules)
    if (!style.isConnected) document.head.appendChild(style)
  }
  notifyThemeListeners()
  return () => unregisterTheme(theme.id)
}

export function unregisterTheme(id: string) {
  if (isBuiltinTheme(id) || !isKnownTheme(id)) return
  delete THEME_META[id]
  THEMES.splice(THEMES.indexOf(id), 1)
  rebuildThemeGroups()
  if (typeof document !== 'undefined') {
    document.getElementById(STYLE_ELEMENT_PREFIX + id)?.remove()
    if (document.documentElement.dataset.theme === id) applyTheme('dark')
  }
  notifyThemeListeners()
}

function isBuiltinTheme(id: string): boolean {
  return BUILTIN_IDS.has(id)
}

type ThemeListener = () => void
const themeListeners = new Set<ThemeListener>()

export function getCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  const current = document.documentElement.dataset.theme || localStorage.getItem('theme')
  return current && isKnownTheme(current) ? current : 'dark'
}

export function subscribeTheme(listener: ThemeListener): () => void {
  themeListeners.add(listener)
  return () => themeListeners.delete(listener)
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  // Shared rules (colour-scheme, native widgets) key on the category, not on a list of theme names.
  document.documentElement.dataset.themeCategory = THEME_META[theme]?.category ?? 'dark'
  localStorage.setItem('theme', theme)
  notifyThemeListeners()
}

function notifyThemeListeners() {
  for (const listener of themeListeners) listener()
}

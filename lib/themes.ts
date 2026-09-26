export type Theme =
  | 'light'
  | 'paper'
  | 'solarized-light'
  | 'github-light'
  | 'gruvbox-light'
  | 'catppuccin-latte'
  | 'rose-pine-dawn'
  | 'ayu-light'
  | 'one-light'
  | 'everforest-light'
  | 'tokyo-night-day'
  | 'quiet-light'
  | 'horizon-light'
  | 'flexoki-light'
  | 'nord-light'
  | 'vitesse-light'
  | 'iceberg-light'
  | 'material-lighter'
  | 'min-light'
  | 'bone-china'
  | 'cold-pressed'
  | 'sunlit-alabaster'
  | 'brushed-aluminium'
  | 'imessage'
  | 'dark'
  | 'terminal'
  | 'solarized-dark'
  | 'solar-flare'
  | 'nord'
  | 'gruvbox-dark'
  | 'dracula'
  | 'fancy-dracula'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'one-dark'
  | 'monokai'
  | 'kanagawa'
  | 'everforest-dark'
  | 'obsidian'
  | 'true-black'
  | 'grove-dark'
  | 'grove-light'
  | 'ocean-dark'
  | 'ocean-light'
  | 'ember-dark'
  | 'ember-light'
  | 'iris-dark'
  | 'iris-light'
  | 't3-chat-dark'
  | 't3-chat-light'
  | 't3-code-dark'
  | 't3-code-light'
  | 'github-dark'
  | 'ayu-dark'
  | 'rose-pine'
  | 'synthwave'
  | 'palenight'
  | 'night-owl'
  | 'flexoki-dark'
  | 'cobalt'
  | 'vitesse-dark'
  | 'iceberg'
  | 'zenburn'
  | 'material-darker'
  | 'claude-code'
  | 'stripe'
  | 'claude-cream'
  | 'supabase'
  | 'posthog'
  | 'replicate'
  | 'notion'
  | 'figma'
  | 'miro'
  | 'apple'
  | 'nike'
  | 'pinterest'
  | 'playstation'
  | 'nvidia'
  | 'mongodb'
  | 'slack'
  | 'cohere'
  | 'mistral'
  | 'cursor'
  | 'airbnb'
  | 'intercom'
  | 'linear'
  | 'sentry'
  | 'raycast'
  | 'framer'
  | 'ferrari'
  | 'resend'
  | 'cyber'
  | 'cyber-wave'
  | 'willow-dream'
  | 'anodised-obsidian'
  | 'dark-ceramic'
  | 'carbon-surface'
  | 'smoked-glass'
  | 'metalterm'
  | 'graphite'
  | 'ember'
  | 'abyss'
  | 'orchid'
  | 'phosphor'
  | 'nocturne'
  | 'slate'
  | 'solstice'
  | 'dune'
  | 'grape'
  | 'repo'
  | 'cappuccino'

export type ThemeCategory = 'dark' | 'light'

export const THEME_META: Record<Theme, { category: ThemeCategory; icon: string; label: string }> = {
  light:              { category: 'light', icon: '☀', label: 'Light' },
  paper:              { category: 'light', icon: '✦', label: 'Paper' },
  'solarized-light':  { category: 'light', icon: '☀', label: 'Solarized Light' },
  'github-light':     { category: 'light', icon: '☀', label: 'GitHub Light' },
  'gruvbox-light':    { category: 'light', icon: '☀', label: 'Gruvbox Light' },
  'catppuccin-latte': { category: 'light', icon: '☀', label: 'Catppuccin Latte' },
  'rose-pine-dawn':   { category: 'light', icon: '☀', label: 'Rosé Pine Dawn' },
  'ayu-light':        { category: 'light', icon: '☀', label: 'Ayu Light' },
  'one-light':        { category: 'light', icon: '☀', label: 'One Light' },
  'everforest-light': { category: 'light', icon: '☀', label: 'Everforest Light' },
  'tokyo-night-day':  { category: 'light', icon: '☀', label: 'Tokyo Night Day' },
  'quiet-light':      { category: 'light', icon: '☀', label: 'Quiet Light' },
  'horizon-light':    { category: 'light', icon: '☀', label: 'Horizon Light' },
  'flexoki-light':    { category: 'light', icon: '☀', label: 'Flexoki Light' },
  'nord-light':       { category: 'light', icon: '☀', label: 'Nord Light' },
  'vitesse-light':    { category: 'light', icon: '☀', label: 'Vitesse Light' },
  'iceberg-light':    { category: 'light', icon: '☀', label: 'Iceberg Light' },
  'material-lighter': { category: 'light', icon: '☀', label: 'Material Lighter' },
  'min-light':        { category: 'light', icon: '☀', label: 'Min Light' },
  'bone-china':       { category: 'light', icon: '◻', label: 'Bone China' },
  'cold-pressed':     { category: 'light', icon: '◻', label: 'Cold-Pressed' },
  'sunlit-alabaster': { category: 'light', icon: '◻', label: 'Sunlit Alabaster' },
  'brushed-aluminium': { category: 'light', icon: '◻', label: 'Brushed Aluminium' },
  stripe:             { category: 'light', icon: '☀', label: 'Stripe' },
  'claude-cream':     { category: 'light', icon: '☀', label: 'Claude Cream' },
  supabase:           { category: 'light', icon: '☀', label: 'Supabase' },
  posthog:            { category: 'light', icon: '☀', label: 'PostHog' },
  replicate:          { category: 'light', icon: '☀', label: 'Replicate' },
  notion:             { category: 'light', icon: '☀', label: 'Notion' },
  figma:              { category: 'light', icon: '☀', label: 'Figma' },
  miro:               { category: 'light', icon: '☀', label: 'Miro' },
  apple:              { category: 'light', icon: '☀', label: 'Apple' },
  nike:               { category: 'light', icon: '☀', label: 'Nike' },
  pinterest:          { category: 'light', icon: '☀', label: 'Pinterest' },
  playstation:        { category: 'light', icon: '☀', label: 'PlayStation' },
  nvidia:             { category: 'light', icon: '☀', label: 'NVIDIA' },
  mongodb:            { category: 'light', icon: '☀', label: 'MongoDB' },
  slack:              { category: 'light', icon: '☀', label: 'Slack' },
  cohere:             { category: 'light', icon: '☀', label: 'Cohere' },
  mistral:            { category: 'light', icon: '☀', label: 'Mistral' },
  cursor:             { category: 'light', icon: '☀', label: 'Cursor' },
  airbnb:             { category: 'light', icon: '☀', label: 'Airbnb' },
  intercom:           { category: 'light', icon: '☀', label: 'Intercom' },
  imessage:           { category: 'light', icon: '💬', label: 'iMessage' },
  dark:               { category: 'dark',  icon: '☾', label: 'Dark' },
  terminal:           { category: 'dark',  icon: '⌨', label: 'Terminal' },
  'solarized-dark':   { category: 'dark',  icon: '☾', label: 'Solarized Dark' },
  'solar-flare':      { category: 'dark',  icon: '✺', label: 'Solar Flare' },
  nord:               { category: 'dark',  icon: '☾', label: 'Nord' },
  'gruvbox-dark':     { category: 'dark',  icon: '☾', label: 'Gruvbox Dark' },
  dracula:            { category: 'dark',  icon: '☾', label: 'Dracula' },
  'fancy-dracula':    { category: 'dark',  icon: '✦', label: 'Fancy Dracula' },
  'tokyo-night':      { category: 'dark',  icon: '☾', label: 'Tokyo Night' },
  'catppuccin-mocha': { category: 'dark',  icon: '☾', label: 'Catppuccin Mocha' },
  'one-dark':         { category: 'dark',  icon: '☾', label: 'One Dark' },
  monokai:            { category: 'dark',  icon: '☾', label: 'Monokai' },
  kanagawa:           { category: 'dark',  icon: '☾', label: 'Kanagawa' },
  'everforest-dark':  { category: 'dark',  icon: '☾', label: 'Everforest Dark' },
  obsidian:           { category: 'dark',  icon: '☾', label: 'Obsidian' },
  'true-black':       { category: 'dark',  icon: '●', label: 'True Black' },
  'grove-dark':        { category: 'dark', icon: '☾', label: 'Grove Dark' },
  'grove-light':       { category: 'light', icon: '☀', label: 'Grove Light' },
  'ocean-dark':        { category: 'dark', icon: '☾', label: 'Ocean Dark' },
  'ocean-light':       { category: 'light', icon: '☀', label: 'Ocean Light' },
  'ember-dark':        { category: 'dark', icon: '☾', label: 'Ember Dark' },
  'ember-light':       { category: 'light', icon: '☀', label: 'Ember Light' },
  'iris-dark':         { category: 'dark', icon: '☾', label: 'Iris Dark' },
  'iris-light':        { category: 'light', icon: '☀', label: 'Iris Light' },
  't3-chat-dark':      { category: 'dark', icon: '☾', label: 'T3 Chat Dark' },
  't3-chat-light':     { category: 'light', icon: '☀', label: 'T3 Chat Light' },
  't3-code-dark':      { category: 'dark', icon: '☾', label: 'T3 Code Dark' },
  't3-code-light':     { category: 'light', icon: '☀', label: 'T3 Code Light' },
  'github-dark':      { category: 'dark',  icon: '☾', label: 'GitHub Dark' },
  'ayu-dark':         { category: 'dark',  icon: '☾', label: 'Ayu Dark' },
  'rose-pine':        { category: 'dark',  icon: '☾', label: 'Rosé Pine' },
  synthwave:          { category: 'dark',  icon: '✦', label: 'Synthwave' },
  palenight:          { category: 'dark',  icon: '☾', label: 'Palenight' },
  'night-owl':        { category: 'dark',  icon: '☾', label: 'Night Owl' },
  'flexoki-dark':     { category: 'dark',  icon: '☾', label: 'Flexoki Dark' },
  cobalt:             { category: 'dark',  icon: '☾', label: 'Cobalt' },
  'vitesse-dark':     { category: 'dark',  icon: '☾', label: 'Vitesse Dark' },
  iceberg:            { category: 'dark',  icon: '☾', label: 'Iceberg' },
  zenburn:            { category: 'dark',  icon: '☾', label: 'Zenburn' },
  'material-darker':  { category: 'dark',  icon: '☾', label: 'Material Darker' },
  'claude-code':      { category: 'dark',  icon: '⌘', label: 'Claude Code' },
  linear:             { category: 'dark',  icon: '☾', label: 'Linear' },
  sentry:             { category: 'dark',  icon: '☾', label: 'Sentry' },
  raycast:            { category: 'dark',  icon: '☾', label: 'Raycast' },
  framer:             { category: 'dark',  icon: '☾', label: 'Framer' },
  ferrari:            { category: 'dark',  icon: '☾', label: 'Ferrari' },
  resend:             { category: 'dark',  icon: '☾', label: 'Resend' },
  cyber:              { category: 'dark',  icon: '✦', label: 'Cyber' },
  'cyber-wave':       { category: 'dark',  icon: '≋', label: 'Cyber Wave' },
  'willow-dream':     { category: 'dark',  icon: '⌁', label: 'Willow Dream' },
  'anodised-obsidian': { category: 'dark', icon: '◆', label: 'Anodised Obsidian' },
  'dark-ceramic':     { category: 'dark', icon: '◆', label: 'Dark Ceramic' },
  'carbon-surface':   { category: 'dark', icon: '◆', label: 'Carbon Surface' },
  'smoked-glass':     { category: 'dark', icon: '◆', label: 'Smoked Glass' },
  metalterm:          { category: 'dark', icon: '◆', label: 'Metalterm' },
  graphite:           { category: 'dark', icon: '◆', label: 'Graphite' },
  ember:              { category: 'dark', icon: '◆', label: 'Ember' },
  abyss:              { category: 'dark', icon: '◆', label: 'Abyss' },
  orchid:             { category: 'dark', icon: '◆', label: 'Orchid' },
  phosphor:           { category: 'dark', icon: '◆', label: 'Phosphor' },
  nocturne:           { category: 'dark', icon: '◆', label: 'Nocturne' },
  slate:              { category: 'dark', icon: '◆', label: 'Slate' },
  solstice:           { category: 'dark', icon: '◆', label: 'Solstice' },
  dune:               { category: 'dark', icon: '◆', label: 'Dune' },
  grape:              { category: 'dark', icon: '◆', label: 'Grape' },
  repo:               { category: 'dark', icon: '◆', label: 'Repo' },
  cappuccino:         { category: 'dark', icon: '◆', label: 'Cappuccino' },
}

export const THEMES: Theme[] = Object.keys(THEME_META) as Theme[]
const VALID_THEMES: Set<string> = new Set(THEMES)
const themesByLabel = (category: ThemeCategory): Theme[] => THEMES
  .filter((theme) => THEME_META[theme].category === category)
  .sort((a, b) => THEME_META[a].label.localeCompare(THEME_META[b].label))
export const THEME_GROUPS: Array<{ category: ThemeCategory; label: string; themes: Theme[] }> = [
  { category: 'light', label: 'Light', themes: themesByLabel('light') },
  { category: 'dark', label: 'Dark', themes: themesByLabel('dark') },
]

type ThemeListener = () => void
const themeListeners = new Set<ThemeListener>()

export function getCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  const current = document.documentElement.dataset.theme || localStorage.getItem('theme')
  return current && VALID_THEMES.has(current) ? current as Theme : 'dark'
}

export function subscribeTheme(listener: ThemeListener): () => void {
  themeListeners.add(listener)
  return () => themeListeners.delete(listener)
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
  for (const listener of themeListeners) listener()
}

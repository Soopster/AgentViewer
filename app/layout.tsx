import type { Metadata } from 'next'
import { Atkinson_Hyperlegible, Inter, Lexend, Merriweather, Noto_Sans, Open_Sans, Roboto, Source_Sans_3 } from 'next/font/google'
import './globals.css'
import './view-style.css'
import { ProviderLoadingToasts } from '@/components/ProviderLoadingToasts'
import { THEME_META, THEME_STYLE_ELEMENT_PREFIX, themeStyleText } from '@/lib/themes'
import { PLUGIN_MANIFESTS } from '@/lib/plugins/catalog'
import { RouteTransition } from '@/components/RouteTransition'
import { RENDER_FONT_IDS, RENDER_FONT_STORAGE_KEY } from '@/lib/renderFonts'
import { COLOR_TREATMENTS, COLOR_TREATMENT_STORAGE_KEY } from '@/lib/colorTreatment'

// The render fonts below apply only once someone picks one (data-render-font), so none is
// preloaded: preloading put nine font files ahead of the app's scripts on every first load.
const atkinson = Atkinson_Hyperlegible({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-atkinson',
  display: 'swap',
  preload: false,
})
const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-source-sans',
  display: 'swap',
  preload: false,
})
const merriweather = Merriweather({
  subsets: ['latin'],
  variable: '--font-merriweather',
  display: 'swap',
  preload: false,
})
const lexend = Lexend({
  subsets: ['latin'],
  variable: '--font-lexend',
  display: 'swap',
  preload: false,
})
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: false,
})
const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--font-open-sans',
  display: 'swap',
  preload: false,
})
const notoSans = Noto_Sans({
  subsets: ['latin'],
  variable: '--font-noto-sans',
  display: 'swap',
  preload: false,
})
const roboto = Roboto({
  subsets: ['latin'],
  variable: '--font-roboto',
  display: 'swap',
  preload: false,
})

export const metadata: Metadata = {
  title: 'Agent Viewer',
  description: 'Browse Claude Code sessions and messages',
}

// Bundled theme packs (plugins/themes-*) are data: their CSS is rendered here so a saved
// theme paints correctly on the first frame, before any plugin code has run.
const BUNDLED_THEMES = PLUGIN_MANIFESTS.flatMap(manifest => ('themes' in manifest ? manifest.themes : []) as readonly { id: string; category: 'dark' | 'light'; css?: string; rules?: string }[]).filter(theme => theme.css)
const THEME_CATEGORIES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(THEME_META).map(([id, meta]) => [id, meta.category])),
  ...Object.fromEntries(BUNDLED_THEMES.map(theme => [theme.id, theme.category])),
}

// Runs synchronously before first paint — prevents a flash of the wrong theme or render font.
// Safe: this is a static literal, not user-supplied content.
const themeScript = `(function(){try{var v=${JSON.stringify(THEME_CATEGORIES)};var t=localStorage.getItem('theme');if(t&&Object.prototype.hasOwnProperty.call(v,t)){document.documentElement.dataset.theme=t;document.documentElement.dataset.themeCategory=v[t];}var f=${JSON.stringify(RENDER_FONT_IDS)};var rf=localStorage.getItem(${JSON.stringify(RENDER_FONT_STORAGE_KEY)});if(rf&&f.indexOf(rf)>=0){document.documentElement.dataset.renderFont=rf;}var c=${JSON.stringify(COLOR_TREATMENTS)};var ct=localStorage.getItem(${JSON.stringify(COLOR_TREATMENT_STORAGE_KEY)});if(ct&&c.indexOf(ct)>=0){document.documentElement.dataset.colorTreatment=ct;}}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${atkinson.variable} ${sourceSans.variable} ${merriweather.variable} ${lexend.variable} ${inter.variable} ${notoSans.variable} ${roboto.variable} ${openSans.variable}`} suppressHydrationWarning>
      <head>
        {/* Intentional blocking inline script: must run synchronously before first paint to prevent theme FOUC. Content is a static literal, not user input. */}
        {/* eslint-disable-next-line react-doctor/no-danger, react-doctor/nextjs-no-native-script */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body><RouteTransition>{children}</RouteTransition><ProviderLoadingToasts />
        {/* After the page's own stylesheets, so a theme's extra rules win ties the way they did in globals.css. */}
        {BUNDLED_THEMES.map(theme => <style key={theme.id} id={THEME_STYLE_ELEMENT_PREFIX + theme.id} dangerouslySetInnerHTML={{ __html: themeStyleText(theme.id, theme.css!, theme.rules) }} />)}
      </body>
    </html>
  )
}

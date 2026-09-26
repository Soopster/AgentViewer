import type { Metadata } from 'next'
import { Atkinson_Hyperlegible, Inter, Lexend, Merriweather, Noto_Sans, Open_Sans, Roboto, Source_Sans_3 } from 'next/font/google'
import './globals.css'
import { THEMES } from '@/lib/themes'
import { RouteTransition } from '@/components/RouteTransition'
import { RENDER_FONT_IDS, RENDER_FONT_STORAGE_KEY } from '@/lib/renderFonts'
import { COLOR_TREATMENTS, COLOR_TREATMENT_STORAGE_KEY } from '@/lib/colorTreatment'

const atkinson = Atkinson_Hyperlegible({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-atkinson',
  display: 'swap',
})
const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-source-sans',
  display: 'swap',
})
const merriweather = Merriweather({
  subsets: ['latin'],
  variable: '--font-merriweather',
  display: 'swap',
})
const lexend = Lexend({
  subsets: ['latin'],
  variable: '--font-lexend',
  display: 'swap',
})
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})
const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--font-open-sans',
  display: 'swap',
})
const notoSans = Noto_Sans({
  subsets: ['latin'],
  variable: '--font-noto-sans',
  display: 'swap',
})
const roboto = Roboto({
  subsets: ['latin'],
  variable: '--font-roboto',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Agent Viewer',
  description: 'Browse Claude Code sessions and messages',
}

// Runs synchronously before first paint — prevents a flash of the wrong theme or render font.
// Safe: this is a static literal, not user-supplied content.
const themeScript = `(function(){try{var v=${JSON.stringify(THEMES)};var t=localStorage.getItem('theme');if(t&&v.indexOf(t)>=0){document.documentElement.dataset.theme=t;}var f=${JSON.stringify(RENDER_FONT_IDS)};var rf=localStorage.getItem(${JSON.stringify(RENDER_FONT_STORAGE_KEY)});if(rf&&f.indexOf(rf)>=0){document.documentElement.dataset.renderFont=rf;}var c=${JSON.stringify(COLOR_TREATMENTS)};var ct=localStorage.getItem(${JSON.stringify(COLOR_TREATMENT_STORAGE_KEY)});if(ct&&c.indexOf(ct)>=0){document.documentElement.dataset.colorTreatment=ct;}}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${atkinson.variable} ${sourceSans.variable} ${merriweather.variable} ${lexend.variable} ${inter.variable} ${notoSans.variable} ${roboto.variable} ${openSans.variable}`} suppressHydrationWarning>
      <head>
        {/* Intentional blocking inline script: must run synchronously before first paint to prevent theme FOUC. Content is a static literal, not user input. */}
        {/* eslint-disable-next-line react-doctor/no-danger, react-doctor/nextjs-no-native-script */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body><RouteTransition>{children}</RouteTransition></body>
    </html>
  )
}

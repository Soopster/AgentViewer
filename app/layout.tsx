import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agent Viewer',
  description: 'Browse Claude Code sessions and messages',
}

// Runs synchronously before first paint — prevents a flash of the wrong theme.
// Safe: this is a static literal, not user-supplied content.
const themeScript = `(function(){var v=['light','paper','solarized-light','github-light','gruvbox-light','catppuccin-latte','rose-pine-dawn','ayu-light','one-light','everforest-light','tokyo-night-day','quiet-light','horizon-light','imessage','dark','terminal','solarized-dark','nord','gruvbox-dark','dracula','tokyo-night','catppuccin-mocha','one-dark','monokai','kanagawa','everforest-dark','obsidian','github-dark','ayu-dark','rose-pine','synthwave','palenight','night-owl','cyber'];var t=localStorage.getItem('theme');if(t&&v.indexOf(t)>=0){document.documentElement.dataset.theme=t;}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}

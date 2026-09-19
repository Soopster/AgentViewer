import { Bot, Boxes, Sparkles } from 'lucide-react'
import type { AgentProvider } from '@/lib/types'

type Props = {
  provider?: AgentProvider | null
  size?: number
  className?: string
}

function BrandSvg({ children, size }: { children: React.ReactNode; size: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  )
}

export default function ProviderIcon({ provider, size = 18, className }: Props) {
  const normalizedProvider = provider ?? 'unknown'
  const sharedProps = { 'aria-hidden': true, size, strokeWidth: 1.8 } as const
  let mark: React.ReactNode

  switch (provider) {
    case 'claude':
    case 'claude-acp':
      mark = (
        <BrandSvg size={size}>
          <path
            fill="currentColor"
            d="M4.25 20 10.15 4h3.7l5.9 16h-3.45l-1.24-3.7H8.92L7.68 20H4.25Zm5.7-6.75h4.06L12 7.24l-2.05 6.01Z"
          />
        </BrandSvg>
      )
      break
    case 'codex':
    case 'codex-acp':
      mark = (
        <BrandSvg size={size}>
          <g stroke="currentColor" strokeWidth="1.65">
            <ellipse cx="12" cy="7.25" rx="4.7" ry="3.15" transform="rotate(30 12 7.25)" />
            <ellipse cx="16.1" cy="9.63" rx="4.7" ry="3.15" transform="rotate(90 16.1 9.63)" />
            <ellipse cx="16.1" cy="14.37" rx="4.7" ry="3.15" transform="rotate(150 16.1 14.37)" />
            <ellipse cx="12" cy="16.75" rx="4.7" ry="3.15" transform="rotate(30 12 16.75)" />
            <ellipse cx="7.9" cy="14.37" rx="4.7" ry="3.15" transform="rotate(90 7.9 14.37)" />
            <ellipse cx="7.9" cy="9.63" rx="4.7" ry="3.15" transform="rotate(150 7.9 9.63)" />
          </g>
        </BrandSvg>
      )
      break
    case 'opencode':
      mark = (
        <BrandSvg size={size}>
          <path d="m9 6-6 6 6 6M15 6l6 6-6 6M14 3l-4 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </BrandSvg>
      )
      break
    case 'pi':
      mark = (
        <BrandSvg size={size}>
          <path fill="currentColor" d="M3 4h18v3h-3.1v13h-3.35V7h-4.1c-.06 5.78-.98 10.11-2.77 13H3.94c1.97-3.13 2.98-7.46 3.04-13H3V4Z" />
        </BrandSvg>
      )
      break
    case 'copilot':
      mark = <Bot {...sharedProps} />
      break
    case 'lmstudio':
      mark = <Boxes {...sharedProps} />
      break
    default:
      mark = <Sparkles {...sharedProps} />
  }

  return (
    <span
      aria-hidden="true"
      className={className ? `av-provider-icon ${className}` : 'av-provider-icon'}
      data-provider={normalizedProvider}
      data-acp={provider === 'claude-acp' || provider === 'codex-acp' ? 'true' : 'false'}
    >
      {mark}
    </span>
  )
}

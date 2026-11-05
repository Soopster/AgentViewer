import StandaloneMessaging from '@/components/cross-session-messaging/StandaloneMessaging'

export default async function AgentsPage({ searchParams }: {
  searchParams: Promise<{ to?: string | string[] }>
}) {
  const { to } = await searchParams
  return <StandaloneMessaging initialRecipient={Array.isArray(to) ? to[0] : to} />
}

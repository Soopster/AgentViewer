import { hasNativeToolCard } from '../../../lib/plugins/nativeTools'
import { reportUiInteraction } from '../../../lib/plugins/uiInteractions'
import type { TuiTranscriptCard } from '../../format/types'

/**
 * A person expanded or folded a card: count it against each tool the card called that a generic card
 * draws (a tool with a dedicated card is not the Adaptive UI's business, and the Web counts the same way).
 * `expanded` is the state the card is going to, not the one it was in.
 */
export function reportCardToolInteraction(card: Pick<TuiTranscriptCard, 'toolNames'>, expanded: boolean, session: { readonly provider?: string; readonly providerInstanceId?: string; readonly sessionId: string } | null | undefined): void {
  for (const name of card.toolNames ?? []) if (!hasNativeToolCard(name)) reportUiInteraction(expanded ? 'expand' : 'fold', name, session)
}

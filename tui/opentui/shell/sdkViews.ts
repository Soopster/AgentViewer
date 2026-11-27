// What the View Studio needs from the host: the view-spec registry, the transcript
// card pipeline it previews on, and the tab strip's paint hook.
export {
  BUILTIN_VIEW_SPECS, CUSTOM_VIEW_NAME_MAX, TRANSCRIPT_VIEW_LABELS, VIEW_SPEC_BASES, VIEW_SPEC_FIELDS, VIEW_SPEC_SECTIONS,
  customViewSpec, cycleViewSpecValue, viewCardStyle, viewQuietTurns, viewSpecField, viewSpecValueLabel,
  type CustomView, type ViewSpec, type ViewSpecField, type ViewSpecKey,
} from '../../viewSpec'
export { registerTabPaintOccluder, type TabPaintOccluder } from '../SessionTabConnection'
export { WindowButton } from '../WindowButton'
export { iconSetSegmentCaps, tuiIcon } from '../icons'
export { tabSegmentCaps } from '../tabStrip'
export { mixHexColor } from '../app/transcriptStyle'
export { TranscriptCard, type TranscriptCardProps } from '../app/TranscriptCard'
export { tabStripColor as railFillColor } from '../app/derived/tabs'
export { densityConfig, streamCompletedTurnHint, streamLandmarkText, transcriptAccent } from '../app/transcriptStyle'
export { IDLE_TICKER_PHRASES } from '../app/chrome'
export { computeAllLandmarks, renderedBodyLines, usesAgentCardPresentation, visibleCardsForTranscriptView } from '../app/transcriptRows'
export { EMPTY_EXPANDED_KEYS } from '../app/timing'
export { buildThreadedMessages } from '../../../lib/threading'
export { formatTranscriptCards } from '../../format'
export type { SessionMessage } from '../../../lib/types'
export type { TuiDensity, TuiThemePalette } from '../../theme'
export { orderStripGroups, shapeStripSegments, stripBadgeSegment, stripFolderLabel, stripSeparatorText } from '../composerStrip'
export type { ComposerStripPart } from '../../../lib/composerStrip'

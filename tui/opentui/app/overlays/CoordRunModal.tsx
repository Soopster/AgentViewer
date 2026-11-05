/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { getProviderAccent } from '../../../theme'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type PlaybookSummary, type ProtocolAutonomy } from '../../../../lib/agentProtocol'
import { type ProviderSelection, type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { basename, join } from 'node:path'
import { composerKeyBindings } from '../composerInput'
import { renderInlineTextSegments } from '../inlineText'
import { type CoordModalFocus, parseCoordContractLines, coordRunProviders } from '../pickers'

export function CoordRunModal({ coordModalOpen, width, height, coordError, provider, selectedSession, coordProviderOverride, coordTeammateProviderOverride, sessionDetail, coordPlaybookName, coordPlaybooks, coordPlaybookArgsDraft, coordDraft, coordModalFocus, theme, coordTextareaRef, handleCoordContentChange, submitCoordinatedRun, composerBaseTextareaStyle, coordAcceptanceDraft, setCoordAcceptanceDraft, coordNonGoalsDraft, setCoordNonGoalsDraft, coordManualQaDraft, setCoordManualQaDraft, coordEscalationDraft, setCoordEscalationDraft, setCoordPlaybookArgsDraft, setCoordModalFocus, coordProviderPoolIndex, coordMaxAgents, coordMaxTokens, setCoordMaxTokens, coordMaxDurationMinutes, setCoordMaxDurationMinutes, coordUseWorktrees, coordGateDraft, setCoordGateDraft, coordRequirePlanApproval, coordAutonomy, coordRequireReview, coordBusy }: {
  coordModalOpen: boolean
  width: number
  height: number
  coordError: string | null
  provider: ProviderSelection
  selectedSession: Session | null
  coordProviderOverride: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null
  coordTeammateProviderOverride: ('claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp')[] | null
  sessionDetail: TuiSessionDetail | null
  coordPlaybookName: string | null
  coordPlaybooks: PlaybookSummary[]
  coordPlaybookArgsDraft: string
  coordDraft: string
  coordModalFocus: 'provider' | 'prompt' | 'acceptance' | 'nonGoals' | 'manualQa' | 'escalation' | 'playbook' | 'playbookArgs' | 'pool' | 'agents' | 'tokenBudget' | 'durationBudget' | 'worktrees' | 'gate' | 'autonomy' | 'plans' | 'review' | 'launch'
  theme: TuiThemePalette
  coordTextareaRef: React.RefObject<TextareaRenderable | null>
  handleCoordContentChange: () => void
  submitCoordinatedRun: () => Promise<void>
  composerBaseTextareaStyle: { backgroundColor: string; textColor: string; focusedBackgroundColor: string; focusedTextColor: string; placeholderColor: string; }
  coordAcceptanceDraft: string
  setCoordAcceptanceDraft: React.Dispatch<React.SetStateAction<string>>
  coordNonGoalsDraft: string
  setCoordNonGoalsDraft: React.Dispatch<React.SetStateAction<string>>
  coordManualQaDraft: string
  setCoordManualQaDraft: React.Dispatch<React.SetStateAction<string>>
  coordEscalationDraft: string
  setCoordEscalationDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordPlaybookArgsDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordModalFocus: React.Dispatch<React.SetStateAction<'provider' | 'prompt' | 'acceptance' | 'nonGoals' | 'manualQa' | 'escalation' | 'playbook' | 'playbookArgs' | 'pool' | 'agents' | 'tokenBudget' | 'durationBudget' | 'worktrees' | 'gate' | 'autonomy' | 'plans' | 'review' | 'launch'>>
  coordProviderPoolIndex: number
  coordMaxAgents: number
  coordMaxTokens: string
  setCoordMaxTokens: React.Dispatch<React.SetStateAction<string>>
  coordMaxDurationMinutes: string
  setCoordMaxDurationMinutes: React.Dispatch<React.SetStateAction<string>>
  coordUseWorktrees: boolean
  coordGateDraft: string
  setCoordGateDraft: React.Dispatch<React.SetStateAction<string>>
  coordRequirePlanApproval: boolean
  coordAutonomy: ProtocolAutonomy
  coordRequireReview: boolean
  coordBusy: boolean
}) {
  return (
    coordModalOpen ? (() => {
        const overlayWidth = Math.max(20, Math.min(Math.max(width - 2, 20), Math.max(92, Math.min(160, Math.floor(width * 0.96)))))
        const overlayHeight = Math.max(24, Math.min(Math.max(height - 2, 24), 44))
        const contentWidth = Math.max(overlayWidth - 4, 16)
        const compact = overlayHeight < 29
        const headerHeight = 3
        const footerHeight = 2
        const bodyHeight = Math.max(overlayHeight - headerHeight - footerHeight - (coordError ? 1 : 0) - 2, 12)
        const splitLayout = contentWidth >= 96 && bodyHeight >= 23
        const runtimePaneWidth = splitLayout ? Math.max(52, Math.floor(contentWidth * 0.58)) : contentWidth
        const sidePaneWidth = splitLayout ? Math.max(contentWidth - runtimePaneWidth - 1, 34) : contentWidth
        const briefHeight = splitLayout
          ? Math.max(14, Math.floor(bodyHeight * 0.48))
          : Math.max(compact ? 5 : 7, bodyHeight - 12 - (compact ? 4 : 5))
        const lowerHeight = Math.max(bodyHeight - briefHeight, 12)
        const runtimeHeight = splitLayout ? lowerHeight : 17
        const summaryHeight = splitLayout ? lowerHeight : (compact ? 4 : 5)
        const suggestedProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
        const targetProvider = coordProviderOverride ?? suggestedProvider
        const teammateProviders = coordTeammateProviderOverride ?? [targetProvider]
        const baseCwdLabel = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
        const workspaceLabel = basename(baseCwdLabel) || baseCwdLabel
        const selectedPlaybook = coordPlaybookName
          ? coordPlaybooks.find((entry) => entry.name === coordPlaybookName) ?? null
          : null
        const playbookArgsReady = !selectedPlaybook?.expectsArgs || coordPlaybookArgsDraft.trim().length > 0
        const launchReady = Boolean(coordDraft.trim() || selectedPlaybook) && playbookArgsReady
        const playbookArgsHint = selectedPlaybook?.argsHint?.trim()
        const playbookArgsPlaceholder = selectedPlaybook
          ? playbookArgsHint && playbookArgsHint.toLowerCase() !== 'none'
            ? playbookArgsHint
            : selectedPlaybook.expectsArgs ? 'Enter required JSON or text' : 'Add optional JSON or text'
          : 'Select a playbook first'
        const promptLineCount = coordDraft.length === 0 ? 1 : coordDraft.split('\n').length
        const briefPreview = coordDraft.trim().split('\n')[0]
          || (selectedPlaybook ? `Playbook: ${selectedPlaybook.name}` : 'Add a workflow brief to continue')
        const briefTextareaHeight = Math.max(3, briefHeight - (compact ? 7 : 8))
        const focusColor = (focus: CoordModalFocus) => coordModalFocus === focus ? theme.cyan : theme.border
        const focusBackground = (focus: CoordModalFocus) => coordModalFocus === focus ? theme.surface3 : theme.surface2
        return (
          <box
            position="absolute"
            top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="heavy"
            borderColor={theme.cyan}
            backgroundColor={theme.surface2}
            zIndex={70}
            flexDirection="column"
            title="NEW WORKFLOW"
            titleColor={theme.cyan}
            titleAlignment="left"
          >
            <box
              height={headerHeight}
              paddingX={1}
              border={['bottom']}
              borderStyle="single"
              borderColor={theme.border}
              backgroundColor={theme.surface2}
              flexDirection="column"
              justifyContent="center"
            >
              <text fg={theme.text} wrapMode="none">LAUNCH A WORKFLOW</text>
              <text fg={theme.dim} wrapMode="none">{fitText('Define the outcome, configure the team, then review exactly what will launch.', contentWidth)}</text>
            </box>

            <box flexGrow={1} flexDirection="column" overflow="hidden">
            <box
              height={briefHeight}
              paddingX={1}
              flexDirection="column"
              overflow="hidden"
              backgroundColor={theme.surface}
              border={['bottom']}
              borderStyle="single"
              borderColor={theme.border}
            >
              <box height={1} flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">01  WORKFLOW BRIEF</text>
                <box flexGrow={1} />
                <text fg={theme.dim} wrapMode="none">{`${coordDraft.length} chars`}</text>
              </box>
              <textarea
                ref={coordTextareaRef}
                focused={coordModalFocus === 'prompt'}
                width={contentWidth}
                height={briefTextareaHeight}
                placeholder="Describe the outcome, constraints, paths in scope, and acceptance checks."
                initialValue={coordDraft}
                keyBindings={composerKeyBindings}
                onContentChange={handleCoordContentChange}
                onSubmit={() => { void submitCoordinatedRun() }}
                style={composerBaseTextareaStyle}
              />
              <text fg={theme.violet} wrapMode="none">CONTRACT  ·  one line or semicolon separated</text>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('acceptance')}>
                <box width={20} flexShrink={0}><text fg={coordModalFocus === 'acceptance' ? theme.text : theme.dim} wrapMode="none">Acceptance checks</text></box>
                <box flexGrow={1} backgroundColor={coordModalFocus === 'acceptance' ? theme.surface3 : theme.surface2}>
                  <input width="100%" focused={coordModalFocus === 'acceptance'} value={coordAcceptanceDraft} placeholder="checks the team must satisfy" maxLength={300} onInput={(value: string) => setCoordAcceptanceDraft(value)} />
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('nonGoals')}>
                <box width={20} flexShrink={0}><text fg={coordModalFocus === 'nonGoals' ? theme.text : theme.dim} wrapMode="none">Non-goals</text></box>
                <box flexGrow={1} backgroundColor={coordModalFocus === 'nonGoals' ? theme.surface3 : theme.surface2}>
                  <input width="100%" focused={coordModalFocus === 'nonGoals'} value={coordNonGoalsDraft} placeholder="areas to leave unchanged" maxLength={240} onInput={(value: string) => setCoordNonGoalsDraft(value)} />
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('manualQa')}>
                <box width={20} flexShrink={0}><text fg={coordModalFocus === 'manualQa' ? theme.text : theme.dim} wrapMode="none">Manual QA</text></box>
                <box flexGrow={1} backgroundColor={coordModalFocus === 'manualQa' ? theme.surface3 : theme.surface2}>
                  <input width="100%" focused={coordModalFocus === 'manualQa'} value={coordManualQaDraft} placeholder="manual checks before completion" maxLength={240} onInput={(value: string) => setCoordManualQaDraft(value)} />
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('escalation')}>
                <box width={20} flexShrink={0}><text fg={coordModalFocus === 'escalation' ? theme.text : theme.dim} wrapMode="none">Escalation</text></box>
                <box flexGrow={1} backgroundColor={coordModalFocus === 'escalation' ? theme.surface3 : theme.surface2}>
                  <input width="100%" focused={coordModalFocus === 'escalation'} value={coordEscalationDraft} placeholder="security, data loss, API risk" maxLength={240} onInput={(value: string) => setCoordEscalationDraft(value)} />
                </box>
              </box>
            </box>

            <box height={splitLayout ? lowerHeight : undefined} flexGrow={splitLayout ? 0 : 1} flexDirection={splitLayout ? 'row' : 'column'} overflow="hidden">
            <box
              height={runtimeHeight}
              width={splitLayout ? runtimePaneWidth : undefined}
              paddingX={1}
              backgroundColor={theme.surface}
              flexDirection="column"
              overflow="hidden"
              border={splitLayout ? ['right'] : ['bottom']}
              borderStyle="single"
              borderColor={theme.border}
            >
              <text fg={theme.cyan} wrapMode="none">02  RUNTIME AND CONTROLS</text>
              <box flexShrink={0} flexDirection="column">
              <text fg={theme.violet} wrapMode="none">WORKFLOW</text>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('playbook')}>
                <text fg={coordModalFocus === 'playbook' ? theme.text : theme.dim} wrapMode="none">{'Playbook      '}</text>
                <text fg={selectedPlaybook ? theme.violet : theme.dim} wrapMode="none">{`‹ ${selectedPlaybook?.name ?? 'none'} ›`}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'playbook' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'playbook' ? '←/→ select · Enter/M manage' : selectedPlaybook ? `${selectedPlaybook.phaseCount} phases · ${selectedPlaybook.taskCount} tasks` : `${coordPlaybooks.length} available`}</text>
              </box>
              <box height={2} flexDirection="column" backgroundColor={focusBackground('playbookArgs')}>
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'playbookArgs' ? theme.text : theme.dim} wrapMode="none">Arguments</text>
                  <text fg={selectedPlaybook?.expectsArgs ? theme.amber : selectedPlaybook ? theme.cyan : theme.dim} wrapMode="none">
                    {selectedPlaybook ? `  ${selectedPlaybook.expectsArgs ? 'required' : 'optional'}` : ''}
                  </text>
                  <box flexGrow={1} />
                  <text fg={coordModalFocus === 'playbookArgs' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'playbookArgs' && selectedPlaybook ? 'type JSON or plain text · Enter next' : ''}</text>
                </box>
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'playbookArgs' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'playbookArgs' ? '› ' : '  '}</text>
                  <box flexGrow={1} backgroundColor={coordModalFocus === 'playbookArgs' ? theme.surface3 : theme.surface2}>
                  {coordModalFocus === 'playbookArgs'
                    ? <input
                        width="100%"
                        focused
                        value={coordPlaybookArgsDraft}
                        placeholder={playbookArgsPlaceholder}
                        maxLength={500}
                        onInput={(value: string) => setCoordPlaybookArgsDraft(value)}
                        onSubmit={() => setCoordModalFocus('provider')}
                      />
                    : <text fg={coordPlaybookArgsDraft ? theme.text : theme.dim} wrapMode="none">{fitText(coordPlaybookArgsDraft || playbookArgsPlaceholder, Math.max(12, runtimePaneWidth - 4))}</text>}
                  </box>
                </box>
              </box>
              <text fg={theme.violet} wrapMode="none">TEAM</text>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('provider')}>
                <text fg={coordModalFocus === 'provider' ? theme.text : theme.dim} wrapMode="none">{'Lead provider  '}</text>
                <text fg={getProviderAccent(targetProvider)} wrapMode="none">{`‹ ${targetProvider.toUpperCase()} ›`}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'provider' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'provider' ? '←/→ choose' : 'coordinates the team'}</text>
              </box>
              <box height={2} flexDirection="column" backgroundColor={focusBackground('pool')} overflow="hidden">
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'pool' ? theme.text : theme.dim} wrapMode="none">Teammate provider pool</text>
                  <box flexGrow={1} />
                  <text fg={coordModalFocus === 'pool' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'pool' ? '←/→ · Space' : 'round-robin'}</text>
                </box>
                <box height={1} flexDirection="row" overflow="hidden">
                  {coordRunProviders().map((providerName, index) => {
                    const selected = teammateProviders.includes(providerName)
                    const cursor = coordModalFocus === 'pool' && coordProviderPoolIndex === index
                    return (
                      <text
                        key={providerName}
                        fg={cursor ? theme.surface : selected ? getProviderAccent(providerName) : theme.dim}
                        bg={cursor ? theme.cyan : undefined}
                        wrapMode="none"
                      >
                        {`${cursor ? '›' : ' '}${selected ? '[x]' : '[ ]'}${providerName.toUpperCase()}${cursor ? '‹' : ' '} `}
                      </text>
                    )
                  })}
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('agents')}>
                <text fg={coordModalFocus === 'agents' ? theme.text : theme.dim} wrapMode="none">{'Agent limit   '}</text>
                <text fg={theme.cyan} wrapMode="none">{`−  ${coordMaxAgents} total  +`}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'agents' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'agents' ? '←/→ adjust' : 'includes the lead'}</text>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground(coordModalFocus === 'durationBudget' ? 'durationBudget' : 'tokenBudget')}>
                <text fg={coordModalFocus === 'tokenBudget' ? theme.text : theme.dim} wrapMode="none">Tokens </text>
                {coordModalFocus === 'tokenBudget'
                  ? <input width={Math.max(10, Math.floor(runtimePaneWidth * 0.2))} focused value={coordMaxTokens} placeholder="optional" maxLength={12} onInput={(value: string) => setCoordMaxTokens(value.replace(/[^0-9]/g, ''))} />
                  : <text fg={coordMaxTokens ? theme.text : theme.dim} wrapMode="none">{coordMaxTokens || '—'}</text>}
                <text fg={theme.dim} wrapMode="none">  ·  Minutes </text>
                {coordModalFocus === 'durationBudget'
                  ? <input width={Math.max(8, Math.floor(runtimePaneWidth * 0.16))} focused value={coordMaxDurationMinutes} placeholder="optional" maxLength={8} onInput={(value: string) => setCoordMaxDurationMinutes(value.replace(/[^0-9]/g, ''))} />
                  : <text fg={coordMaxDurationMinutes ? theme.text : theme.dim} wrapMode="none">{coordMaxDurationMinutes || '—'}</text>}
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'tokenBudget' || coordModalFocus === 'durationBudget' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'tokenBudget' || coordModalFocus === 'durationBudget' ? 'Enter next' : 'optional'}</text>
              </box>
              <text fg={theme.violet} wrapMode="none">EXECUTION</text>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('worktrees')}>
                <text fg={coordUseWorktrees ? theme.green : theme.amber} wrapMode="none">{coordUseWorktrees ? '[x]' : '[ ]'}</text>
                <text fg={coordModalFocus === 'worktrees' ? theme.text : theme.dim} wrapMode="none">{' Use separate teammate checkouts'}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'worktrees' ? theme.cyan : theme.dim} wrapMode="none">{coordUseWorktrees ? 'isolated' : 'shared checkout'}</text>
              </box>
              <box height={2} flexDirection="column" backgroundColor={focusBackground('gate')}>
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'gate' ? theme.text : theme.dim} wrapMode="none">Completion gate</text>
                  <text fg={theme.dim} wrapMode="none">  optional</text>
                  <box flexGrow={1} />
                  <text fg={coordModalFocus === 'gate' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'gate' ? 'shell command · Enter next' : ''}</text>
                </box>
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'gate' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'gate' ? '› ' : '  '}</text>
                  <box flexGrow={1} backgroundColor={coordModalFocus === 'gate' ? theme.surface3 : theme.surface2}>
                    {coordModalFocus === 'gate'
                      ? <input
                          width="100%"
                          focused
                          value={coordGateDraft}
                          placeholder="Example: npx tsc --noEmit"
                          maxLength={200}
                          onInput={(value: string) => setCoordGateDraft(value)}
                          onSubmit={() => setCoordModalFocus('autonomy')}
                        />
                      : <text fg={coordGateDraft ? theme.text : theme.dim} wrapMode="none">{fitText(coordGateDraft || 'Example: npx tsc --noEmit', Math.max(12, runtimePaneWidth - 4))}</text>}
                  </box>
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('plans')}>
                <text fg={coordRequirePlanApproval ? theme.amber : theme.dim} wrapMode="none">{coordRequirePlanApproval ? '[x]' : '[ ]'}</text>
                <text fg={coordModalFocus === 'plans' ? theme.text : theme.dim} wrapMode="none">{' Review the lead plan before implementation'}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'plans' ? theme.cyan : theme.dim} wrapMode="none">{coordRequirePlanApproval ? 'required' : 'automatic'}</text>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('autonomy')}>
                <text fg={coordModalFocus === 'autonomy' ? theme.text : theme.dim} wrapMode="none">Autonomy      </text>
                <text fg={coordAutonomy === 'high' ? theme.amber : theme.cyan} wrapMode="none">{`‹ ${coordAutonomy.toUpperCase()} ›`}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'autonomy' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'autonomy' ? '←/→ choose' : 'decision threshold'}</text>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('review')}>
                <text fg={coordRequireReview ? theme.amber : theme.dim} wrapMode="none">{coordRequireReview ? '[x]' : '[ ]'}</text>
                <text fg={coordModalFocus === 'review' ? theme.text : theme.dim} wrapMode="none"> Judgment review before synthesis</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'review' ? theme.cyan : theme.dim} wrapMode="none">{coordRequireReview ? 'required' : 'automatic'}</text>
              </box>
              </box>
            </box>

            <box height={summaryHeight} width={splitLayout ? sidePaneWidth : undefined} flexGrow={splitLayout ? 1 : 0} paddingX={1} backgroundColor={theme.surface} flexDirection="column">
              <text fg={theme.cyan} wrapMode="none">03  LAUNCH SUMMARY</text>
              {splitLayout ? (
                <>
                  {lowerHeight >= 18 ? <text fg={theme.violet} wrapMode="none">CONTEXT</text> : null}
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Workspace</text><box flexGrow={1} /><text fg={theme.text}>{fitText(workspaceLabel, Math.max(sidePaneWidth - 16, 12))}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Playbook</text><box flexGrow={1} /><text fg={selectedPlaybook ? theme.violet : theme.dim}>{fitText(selectedPlaybook?.name ?? 'Lead plans board', Math.max(sidePaneWidth - 16, 12))}</text></box>
                  {lowerHeight >= 18 ? <text fg={theme.violet} wrapMode="none">TEAM</text> : null}
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Lead</text><box flexGrow={1} /><text fg={getProviderAccent(targetProvider)}>{targetProvider.toUpperCase()}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Teammate pool</text><box flexGrow={1} /><text fg={theme.violet}>{fitText(teammateProviders.map((entry) => entry.toUpperCase()).join(' + '), Math.max(sidePaneWidth - 20, 12))}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Agent limit</text><box flexGrow={1} /><text fg={theme.cyan}>{`${coordMaxAgents} total`}</text></box>
                  {lowerHeight >= 18 ? <text fg={theme.violet} wrapMode="none">EXECUTION</text> : null}
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Checkout mode</text><box flexGrow={1} /><text fg={coordUseWorktrees ? theme.green : theme.amber}>{coordUseWorktrees ? 'Isolated checkouts' : 'Shared checkout'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Plan review</text><box flexGrow={1} /><text fg={coordRequirePlanApproval ? theme.amber : theme.green}>{coordRequirePlanApproval ? 'Required' : 'Automatic'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Autonomy</text><box flexGrow={1} /><text fg={coordAutonomy === 'high' ? theme.amber : theme.cyan}>{coordAutonomy.toUpperCase()}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Judgment review</text><box flexGrow={1} /><text fg={coordRequireReview ? theme.amber : theme.green}>{coordRequireReview ? 'Required' : 'Automatic'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Acceptance checks</text><box flexGrow={1} /><text fg={coordAcceptanceDraft.trim() ? theme.cyan : theme.dim}>{coordAcceptanceDraft.trim() ? `${parseCoordContractLines(coordAcceptanceDraft).length} configured` : 'Not configured'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Budgets</text><box flexGrow={1} /><text fg={coordMaxTokens || coordMaxDurationMinutes ? theme.amber : theme.dim}>{coordMaxTokens || coordMaxDurationMinutes ? `${coordMaxTokens || '—'} tokens · ${coordMaxDurationMinutes || '—'} min` : 'Unbounded'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Completion gate</text><box flexGrow={1} /><text fg={coordGateDraft.trim() ? theme.amber : theme.dim}>{fitText(coordGateDraft.trim() || 'Not configured', Math.max(sidePaneWidth - 23, 12))}</text></box>
                  <box height={2} marginTop={1} flexDirection="column"><text fg={theme.dim}>BRIEF PREVIEW</text><text fg={theme.text}>{fitText(briefPreview, sidePaneWidth - 2)}</text></box>
                </>
              ) : (
                <>
                  <text fg={theme.dim} wrapMode="none">
                    {renderInlineTextSegments([
                      { text: `workspace ${workspaceLabel}`, fg: theme.text },
                      { text: '  ·  ', fg: theme.dim },
                      { text: selectedPlaybook?.name ?? 'lead-planned', fg: selectedPlaybook ? theme.violet : theme.dim },
                      { text: '  ·  ', fg: theme.dim },
                      { text: targetProvider.toUpperCase(), fg: getProviderAccent(targetProvider) },
                      { text: '  ·  ', fg: theme.dim },
                      { text: `pool ${teammateProviders.map((entry) => entry.toUpperCase()).join('+')}`, fg: theme.violet },
                      { text: '  ·  ', fg: theme.dim },
                      { text: `${coordMaxAgents} agents`, fg: theme.cyan },
                      { text: '  ·  ', fg: theme.dim },
                      { text: coordUseWorktrees ? 'isolated' : 'shared checkout', fg: coordUseWorktrees ? theme.green : theme.amber },
                      { text: '  ·  ', fg: theme.dim },
                      { text: `${parseCoordContractLines(coordAcceptanceDraft).length} acceptance checks`, fg: coordAcceptanceDraft.trim() ? theme.cyan : theme.dim },
                    ], sidePaneWidth - 2, theme.dim)}
                  </text>
                  {!compact ? <text fg={theme.dim} wrapMode="none">{fitText(`Brief: ${briefPreview}`, sidePaneWidth - 2)}</text> : null}
                </>
              )}
              <box height={1} flexDirection="row" backgroundColor={focusBackground('launch')}>
                <text fg={launchReady ? (coordModalFocus === 'launch' ? theme.surface : theme.green) : theme.dim} bg={launchReady && coordModalFocus === 'launch' ? theme.green : undefined} wrapMode="none">
                  {coordBusy ? ' ◇ LAUNCHING WORKFLOW… ' : ' ▶ LAUNCH WORKFLOW '}
                </text>
                <box flexGrow={1} />
                {!splitLayout ? <text fg={theme.dim} wrapMode="none">{launchReady ? 'lead · task board · live activity' : selectedPlaybook?.expectsArgs && !playbookArgsReady ? 'playbook args required' : 'brief or playbook required'}</text> : null}
              </box>
            </box>
            </box>
            </box>

            {coordError ? (
              <box paddingX={1} height={1} overflow="hidden">
                <text fg={theme.red} wrapMode="none">{fitText(coordError, contentWidth)}</text>
              </box>
            ) : null}

            <box
              height={footerHeight}
              paddingX={1}
              border={['top']}
              borderStyle="single"
              borderColor={theme.border}
              backgroundColor={theme.surface2}
              flexDirection="row"
              alignItems="center"
            >
              <text fg={coordBusy ? theme.amber : theme.dim} wrapMode="none">
                {coordBusy
                  ? 'Starting lead…'
                  : `${promptLineCount} line${promptLineCount === 1 ? '' : 's'} · ${coordDraft.length} chars`}
              </text>
              <box flexGrow={1} />
              <text fg={theme.dim} wrapMode="none">
                {fitText('Tab/Shift+Tab focus · arrows adjust · Enter activate · Ctrl+T agents · Ctrl+P plan · Esc close', Math.max(contentWidth - 24, 20))}
              </text>
            </box>
          </box>
        )
      })() : null
  )
}

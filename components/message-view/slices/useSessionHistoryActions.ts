import { useState } from 'react'
import type { RewindPreview, RollbackPreview } from '../types'

export function useSessionHistoryActions() {
  const [rewindTargetId, setRewindTargetId] = useState('')
  const [rollbackTurns, setRollbackTurns] = useState(1)
  const [resumeFromMessageId, setResumeFromMessageId] = useState<string | null>(null)
  const [previewingRewind, setPreviewingRewind] = useState(false)
  const [applyingRewind, setApplyingRewind] = useState(false)
  const [rewindPreview, setRewindPreview] = useState<RewindPreview | null>(null)
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null)
  const [forking, setForking] = useState(false)
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null)
  return {
    rewindTargetId, setRewindTargetId, rollbackTurns, setRollbackTurns, resumeFromMessageId,
    setResumeFromMessageId, previewingRewind, setPreviewingRewind, applyingRewind, setApplyingRewind,
    rewindPreview, setRewindPreview, rollbackPreview, setRollbackPreview, forking, setForking,
    forkingMessageId, setForkingMessageId,
  }
}

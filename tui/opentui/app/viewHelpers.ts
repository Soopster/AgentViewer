import { formatSessionProject } from '../../format'
import { type TuiDensity } from '../../theme'
import { type Session } from '../../../lib/types'

export function cycleDensityValue(current: TuiDensity): TuiDensity {
  return current === 'comfortable'
    ? 'balanced'
    : current === 'balanced'
    ? 'dense'
    : 'comfortable'
}

export function currentProjectName(session: Session | null): string {
  return session ? formatSessionProject(session) : 'no-project'
}
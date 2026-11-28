// Where the vendored pstack lives, and which skills it ships. Node only.
import { skillPackLibrary } from '../skillPacks/library'

const pack = skillPackLibrary('pstack', 'AGENT_VIEWER_PSTACK_DIR')
export const pstackDir = pack.dir
export const pstackLibraryDir = pack.libraryDir
export const pstackSkillsDir = pack.skillsDir
export const pstackSkillFile = pack.skillFile
export const listPstackSkills = pack.list

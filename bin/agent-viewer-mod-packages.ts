// Explicit package operations only. This command never imports installed code.
import { inspectModPackage, installModPackage, listModPackages, removeModPackage, rollbackModPackage } from '../lib/plugins/modPackages'
const [verb, name, ...args] = process.argv.slice(2)
const usage = 'Usage: agent-viewer mods inspect <source> | install <source> --sha256 <digest> | update <id> --source <source> --sha256 <digest> | remove <id> | rollback <id> | list'
try {
  let result: unknown
  if (verb === 'inspect' && name && !args.length) result = inspectModPackage(name)
  else if (verb === 'install' && name && args.length === 2 && args[0] === '--sha256') result = installModPackage(name, args[1]!)
  else if (verb === 'update' && name && args.length === 4 && args[0] === '--source' && args[2] === '--sha256') result = installModPackage(args[1]!, args[3]!, name)
  else if (verb === 'remove' && name && !args.length) result = removeModPackage(name)
  else if (verb === 'rollback' && name && !args.length) result = rollbackModPackage(name)
  else if (verb === 'list' && name === undefined) result = listModPackages()
  else throw new Error(usage)
  console.log(JSON.stringify({ ok: true, result, ...(verb === 'inspect' || verb === 'list' ? {} : { activation: 'Reload the running instance or restart it to apply package changes.' }) }, null, 2))
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }

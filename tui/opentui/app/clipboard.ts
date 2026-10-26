import type { CliRenderer } from '@opentui/core'
import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { isAbsolute, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TuiTranscriptCard } from '../../format'
import { pastedImageDisplayName } from './composerInput'
import { NATIVE_OSC_ENABLED } from './timing'
import type { ClipboardImage } from './types'

function parseFileUrlList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const url = new URL(line)
        return url.protocol === 'file:' ? [decodeURIComponent(url.pathname)] : []
      } catch {
        return []
      }
    })
}
function clipboardImageMimeTypeForPath(path: string): string | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return null
}
export function pastedFileMimeTypeForPath(path: string): string {
  const imageMime = clipboardImageMimeTypeForPath(path)
  if (imageMime) return imageMime
  const lower = path.toLowerCase()
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown'
  return 'text/plain'
}
export function normalizePastedFilePath(value: string, cwd: string | null | undefined): string | null {
  const raw = value.trim().replace(/^['"]+|['"]+$/g, '')
  if (!raw || raw.includes('\n')) return null
  let path = raw
  if (path.startsWith('file://')) {
    try {
      path = fileURLToPath(path)
    } catch {
      return null
    }
  } else if (process.platform !== 'win32') {
    path = path.replace(/\\(.)/g, '$1')
  }
  if (/^https?:\/\//i.test(path)) return null
  return isAbsolute(path) ? path : resolve(cwd || process.cwd(), path)
}
function appleScriptStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
export function isWslRuntime(): boolean {
  return process.platform === 'linux' && release().includes('WSL')
}
function runClipboardCommand(command: string, args: readonly string[] = [], timeoutMs = 2500): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: process.env.CLANG_MODULE_CACHE_PATH || '/tmp/agent-viewer-clang-module-cache',
      },
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Clipboard command timed out: ${command}`))
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    child.stdout.on('data', (chunk) => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.stderr.on('data', (chunk) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(Buffer.concat(stdout))
        return
      }
      reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `Clipboard command failed: ${command}`))
    })
  })
}
export async function readClipboardText(): Promise<string> {
  const platform = process.platform
  const windowsClipboard = platform === 'win32' || isWslRuntime()
  const candidates = platform === 'darwin'
    ? [['pbpaste', []] as const]
    : windowsClipboard
      ? [['powershell.exe', ['-NonInteractive', '-NoProfile', '-Command', 'Get-Clipboard -Raw']] as const]
      : [
        ['wl-paste', ['--no-newline']] as const,
        ['xclip', ['-selection', 'clipboard', '-o']] as const,
        ['xsel', ['--clipboard', '--output']] as const,
      ]

  let lastError: Error | null = null
  for (const [command, args] of candidates) {
    try {
      return (await runClipboardCommand(command, args)).toString('utf8')
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error('No clipboard command available')
}

async function readMacClipboardImageWithAppleScript(): Promise<ClipboardImage | null> {
  const tmpfile = join(tmpdir(), `agent-viewer-clipboard-${process.pid}.png`)
  try {
    await runClipboardCommand('osascript', [
      '-e',
      'set imageData to the clipboard as "PNGf"',
      '-e',
      `set fileRef to open for access POSIX file ${appleScriptStringLiteral(tmpfile)} with write permission`,
      '-e',
      'set eof fileRef to 0',
      '-e',
      'write imageData to fileRef',
      '-e',
      'close access fileRef',
    ], 3500)
    const data = await readFile(tmpfile, 'base64')
    if (!data) return null
    return {
      data,
      mimeType: 'image/png',
      displayName: pastedImageDisplayName('image/png'),
    }
  } catch {
    return null
  } finally {
    await rm(tmpfile, { force: true }).catch(() => { })
  }
}

async function readMacClipboardImageWithSwift(): Promise<ClipboardImage | null> {
  const script = `
import AppKit
import Foundation

func emit(_ mimeType: String, _ data: Data) -> Never {
  print(mimeType)
  print(data.base64EncodedString())
  exit(0)
}

func emitImage(_ image: NSImage) -> Never? {
  guard let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:]) else {
    return nil
  }
  emit("image/png", png)
}

let pasteboard = NSPasteboard.general

if let png = pasteboard.data(forType: .png), !png.isEmpty {
  emit("image/png", png)
}

if let tiff = pasteboard.data(forType: .tiff),
   let rep = NSBitmapImageRep(data: tiff),
   let png = rep.representation(using: .png, properties: [:]) {
  emit("image/png", png)
}

if let image = NSImage(pasteboard: pasteboard) {
  _ = emitImage(image)
}

if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL] {
  for url in urls where url.isFileURL {
    let ext = url.pathExtension.lowercased()
    let mimeType: String?
    switch ext {
    case "png": mimeType = "image/png"
    case "jpg", "jpeg": mimeType = "image/jpeg"
    case "gif": mimeType = "image/gif"
    case "webp": mimeType = "image/webp"
    default: mimeType = nil
    }
    if let mimeType, let data = try? Data(contentsOf: url), !data.isEmpty {
      emit(mimeType, data)
    }
  }
}

exit(2)
`

  try {
    const output = await runClipboardCommand('swift', ['-e', script], 10000)
    const lines = output.toString('utf8').trim().split(/\r?\n/)
    const mimeType = lines.shift()?.trim()
    const data = lines.join('').trim()
    if (!mimeType?.startsWith('image/') || !data) return null
    return {
      data,
      mimeType,
      displayName: pastedImageDisplayName(mimeType),
    }
  } catch {
    return null
  }
}
export async function readClipboardImage(): Promise<ClipboardImage | null> {
  const platform = process.platform
  const windowsClipboard = platform === 'win32' || isWslRuntime()
  if (platform === 'darwin') {
    const appleScriptImage = await readMacClipboardImageWithAppleScript()
    if (appleScriptImage) return appleScriptImage

    const swiftImage = await readMacClipboardImageWithSwift()
    if (swiftImage) return swiftImage
  }
  const candidates: Array<{ command: string; args: string[]; mimeType: string; base64Output?: boolean} > = platform === 'darwin'
    ? [
      { command: 'pngpaste', args: ['-'], mimeType: 'image/png' },
      {
        command: 'osascript',
        args: [
          '-l',
          'JavaScript',
          '-e',
          "ObjC.import('AppKit'); const pb=$.NSPasteboard.generalPasteboard; let data=pb.dataForType($.NSPasteboardTypePNG) || pb.dataForType('public.png'); if (!data) { const tiff=pb.dataForType($.NSPasteboardTypeTIFF) || pb.dataForType('public.tiff'); if (tiff) { const rep=$.NSBitmapImageRep.imageRepWithData(tiff); if (rep) data=rep.representationUsingTypeProperties(4, $.NSDictionary.dictionary); } } if (!data) $.exit(2); console.log(ObjC.unwrap(data.base64EncodedStringWithOptions(0)));",
        ],
        mimeType: 'image/png',
        base64Output: true,
      },
    ]
    : windowsClipboard
      ? [{
        command: 'powershell.exe',
        args: [
          '-NonInteractive',
          '-NoProfile',
          '-command',
          "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img=[Windows.Forms.Clipboard]::GetImage(); if ($null -eq $img) { exit 2 }; $ms=New-Object IO.MemoryStream; $img.Save($ms,[Drawing.Imaging.ImageFormat]::Png); [Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))",
        ],
        mimeType: 'image/png',
        base64Output: true,
      }]
      : [
        { command: 'wl-paste', args: ['-t', 'image/png'], mimeType: 'image/png' },
        { command: 'wl-paste', args: ['-t', 'image/jpeg'], mimeType: 'image/jpeg' },
        { command: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'], mimeType: 'image/png' },
        { command: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/jpeg', '-o'], mimeType: 'image/jpeg' },
      ]

  for (const candidate of candidates) {
    try {
      const output = await runClipboardCommand(candidate.command, candidate.args, 3500)
      const data = candidate.base64Output
        ? output.toString('utf8').trim()
        : output.toString('base64')
      if (!data) continue
      return {
        data,
        mimeType: candidate.mimeType,
        displayName: pastedImageDisplayName(candidate.mimeType),
      }
    } catch {
      // Try the next clipboard backend/format.
    }
  }

  if (platform === 'darwin') {
    try {
      const output = await runClipboardCommand('osascript', [
        '-l',
        'JavaScript',
        '-e',
        "ObjC.import('AppKit'); const pb=$.NSPasteboard.generalPasteboard; const urls=pb.readObjectsForClassesOptions($[$.NSURL.class], null); if (!urls || urls.count === 0) $.exit(2); for (let i=0; i<urls.count; i++) console.log(ObjC.unwrap(urls.objectAtIndex(i).absoluteString));",
      ], 3500)
      for (const path of parseFileUrlList(output.toString('utf8'))) {
        const mimeType = clipboardImageMimeTypeForPath(path)
        if (!mimeType) continue
        const data = await readFile(path, 'base64')
        return {
          data,
          mimeType,
          displayName: path.split('/').pop() || pastedImageDisplayName(mimeType),
        }
      }
    } catch {
      // Clipboard does not contain image file URLs.
    }
  }

  return null
}
// Local desktop clipboard tools (pbcopy, xclip, ...) aren't installed in a
// lot of remote/SSH/container environments this TUI runs in. OSC 52 is a
// terminal escape sequence that asks the *local* terminal emulator (the one
// the user is actually looking at) to set its clipboard, so it works over
// SSH/tmux/mosh with no server-side clipboard binary at all — it's the
// fallback for exactly the case the shell commands can't cover, so it only
// gets tried once every shell candidate has failed. renderer.isOsc52Supported()
// depends on a terminal capability probe that resolves shortly after startup,
// so a renderer passed in before that probe lands just means we skip the
// fallback and surface the original shell-command error, same as today.
export async function writeClipboard(text: string, renderer?: CliRenderer): Promise<void> {
  const tryCommand = (command: string, args: readonly string[] = []): Promise<void> => (
    new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        stdio: ['pipe', 'ignore', 'pipe'],
      })

      let stderr = ''
      child.on('error', reject)
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on('close', (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(stderr.trim() || `Clipboard command failed: ${command}`))
      })
      child.stdin.end(text)
    })
  )

  const platform = process.platform
  const windowsClipboard = platform === 'win32' || isWslRuntime()
  const candidates = platform === 'darwin'
    ? [['pbcopy', []] as const]
    : windowsClipboard
      ? [
        [
          'powershell.exe',
          [
            '-NonInteractive',
            '-NoProfile',
            '-Command',
            '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())',
          ],
        ] as const,
        [platform === 'win32' ? 'clip' : 'clip.exe', []] as const,
      ]
      : [
        ['wl-copy', []] as const,
        ['xclip', ['-selection', 'clipboard']] as const,
        ['xsel', ['--clipboard', '--input']] as const,
      ]

  let lastError: Error | null = null
  for (const [command, args] of candidates) {
    try {
      await tryCommand(command, args)
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (NATIVE_OSC_ENABLED && renderer?.isOsc52Supported() && renderer.copyToClipboardOSC52(text)) return

  throw lastError ?? new Error('No clipboard command available')
}
export function cardClipboardText(card: TuiTranscriptCard): string {
  const sections: string[] = []
  const mainBody = card.markdownContent
    ?? card.expandedLines.map((line) => line.text).join('\n').trim()

  if (mainBody) sections.push(mainBody)

  if (card.codeBlocks?.length) {
    for (const block of card.codeBlocks) {
      sections.push(`\`\`\`${block.lang}\n${block.content}\n\`\`\``)
    }
  }

  if (card.editDiff) {
    sections.push(card.editDiff)
  }

  return sections.join('\n\n').trim()
}

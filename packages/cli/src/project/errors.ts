import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Src } from '@pcbjs/core/internal/types'
import { isUserFile, localFrames, urlPath } from '@pcbjs/core/internal/provenance'
import { sourcePath } from './files.js'

export const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '')
const stackLines = (text: string) =>
  strip(text)
    .split('\n')
    .filter(line => /^\s+at /.test(line))
const pathOf = (file: string) => (file.startsWith('file://') ? urlPath(file) : file)
const validSource = (src: any): src is Src =>
  typeof src?.file === 'string' && isUserFile(src.file) && Number.isInteger(src.line) && src.line > 0 && Number.isInteger(src.col) && src.col > 0

/** Compiler ranges win over loader locations and source-mapped author frames. */
export function errorSource(e: any): Src | undefined {
  if (validSource(e?.src)) return { ...e.src, file: pathOf(e.src.file) }
  const loc = e?.loc
  if (loc) {
    const src = { file: loc.file, line: loc.line, col: loc.column + 1 }
    if (validSource(src)) return { ...src, file: pathOf(src.file) }
  }
  const located = /\(([^()\n]+\.[cm]?[jt]sx?):(\d+):(\d+)\)/.exec(String(e?.message ?? ''))
  if (located && isUserFile(located[1])) return { file: pathOf(located[1]), line: +located[2], col: +located[3] }
  return localFrames(strip(String(e?.stack ?? ''))).find(validSource)
}

const disk = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** A bounded excerpt from the source version that actually failed. */
export function errorFrame(e: any, root?: string, read: (file: string) => string | null = disk): string | undefined {
  if (typeof e?.frame === 'string' && e.frame.trim()) return strip(e.frame)
  const src = errorSource(e)
  if (!src) return undefined
  const text = read(root ? resolve(root, src.file) : src.file)
  if (text === null) return undefined
  const lines = text.split(/\r?\n/)
  if (src.line > lines.length) return undefined
  const first = Math.max(1, src.line - 2),
    last = Math.min(lines.length, src.line + 2)
  const width = String(last).length
  const out: string[] = []
  for (let line = first; line <= last; line++) {
    out.push(`${line === src.line ? '>' : ' '} ${String(line).padStart(width)} | ${lines[line - 1].replace(/\t/g, '    ')}`)
    if (line === src.line) {
      const prefix = lines[line - 1].slice(0, src.col - 1).replace(/\t/g, '    ')
      const length = src.endLine === src.line && src.endCol ? src.endCol - src.col : 1
      out.push(`  ${' '.repeat(width)} | ${' '.repeat(prefix.length)}${'^'.repeat(Math.max(1, Math.min(length, 80)))}`)
    }
  }
  return out.join('\n')
}

export function errorTrace(e: any, root?: string): string[] {
  const src = errorSource(e)
  const keyOf = (s: Src) => `${root ? resolve(root, s.file) : pathOf(s.file)}:${s.line}:${s.col}`
  const seen = new Set(src ? [keyOf(src)] : [])
  return localFrames(strip(String(e?.stack ?? '')))
    .filter(validSource)
    .flatMap(frame => {
      const key = keyOf(frame)
      if (seen.has(key)) return []
      seen.add(key)
      return [`  at ${root ? sourcePath(root, frame.file) : frame.file}:${frame.line}:${frame.col}`]
    })
    .slice(0, 6)
}

/** Public context by default; implementation stacks only for explicit verbose debugging. */
export function errorText(e: any, verbose = false, root?: string): { line: string; detail: string[] } {
  const src = errorSource(e)
  let message = strip(String(e?.message ?? e)).replace(/^(?:Error|CompileError|SchematicError):\s*/, '')
  if (src) message = message.replace(/\s*\([^()\n]+\.[cm]?[jt]sx?:\d+:\d+\)\s*$/, '')
  const lines = message.split('\n').filter(line => !/^\s+at /.test(line))
  let first = lines.findIndex(line => !!line.trim())
  if (first < 0) first = 0
  let head = lines[first] ?? ''
  if (src) head = head.replace(/\s*\([^()\n]+\.[cm]?[jt]sx?:\d+:\d+\)\s*$/, '')
  const location = src ? `${root ? sourcePath(root, src.file) : src.file}:${src.line}:${src.col}: ` : ''
  const detail = lines.slice(first + 1).filter(line => !!line.trim())
  const frame = errorFrame(e, root)
  if (frame) detail.push('', ...frame.split('\n'))
  const trace = errorTrace(e, root)
  if (trace.length) detail.push('', 'Called from:', ...trace)
  if (verbose) {
    const stack = stackLines(String(e?.stack ?? ''))
    if (stack.length) detail.push('', 'Debug stack:', ...stack)
  }
  return { line: `${location}${head}`, detail }
}

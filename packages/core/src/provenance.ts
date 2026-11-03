// Where author code ran: the one stack frame parser and the one test for a frame of pcbjs's own code.
import type { Src } from './types.js'
import { platform } from './platform.js'
import { realm } from './realm.js'

/** A stack frame position, 1-based. */
export interface Frame {
  file: string
  line: number
  col: number
}

/** A file URL's path; on Windows without the slash before the drive letter. */
export const urlPath = (url: string) => decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

const HERE = (() => {
  try {
    return urlPath(new URL('.', import.meta.url).href)
  } catch {
    return ''
  }
})()
// the parent of every pcbjs package: packages/ in the repository, node_modules/@pcbjs/ installed
const PACKAGES = HERE ? HERE.replace(/[\\/][^\\/]+[\\/]dist[\\/]?$/, '/') : ''
const OWN = /[\\/](?:pcbjs|@pcbjs[\\/][\w.-]+|packages[\\/](?:cli|compile|core|export|fab|kicad|lib|lsp|pcbjs|step|ts-plugin|ui|viewer|vscode))[\\/](?:dist|src)[\\/]/

/** True for pcbjs's own code, built or source, in a checkout (packages/<name>) or installed (node_modules/pcbjs, @pcbjs/<name>). */
export const isOwnFile = (file: string): boolean => OWN.test(file) || (!!PACKAGES && file.startsWith(PACKAGES) && /^[^\\/]+[\\/]dist[\\/]/.test(file.slice(PACKAGES.length)))

/** A file of the author's: not Node's, not a dependency's, not pcbjs's own. */
export const isUserFile = (file: string): boolean => !file.startsWith('node:') && !/[\\/]node_modules[\\/]/.test(file) && !isOwnFile(file)

const FRAME = /^\s*at (?:.*? \()?(.+?):(\d+):(\d+)\)?\s*$/

/** The position of one stack line as written, `at f (file:line:col)` or `at file:line:col`; the file may be a URL. */
export function parseFrame(line: string): Frame | null {
  const m = FRAME.exec(line)
  return m ? { file: m[1], line: +m[2], col: +m[3] } : null
}

/** Every frame of a stack as written, innermost first. */
export const framesOf = (stack: string): Frame[] => stack.split('\n').flatMap(l => parseFrame(l) ?? [])

/** A frame at a file path: a file URL becomes its path, a frame at another URL is null. */
function onDisk(f: Frame): Frame | null {
  if (!/^[a-z][\w+.-]*:\/\//.test(f.file)) return f
  if (!f.file.startsWith('file://')) return null
  try {
    return { ...f, file: urlPath(f.file) }
  } catch {
    return null
  }
}

/** The frames of a stack at file paths, innermost first. */
export const localFrames = (stack: string): Frame[] => framesOf(stack).flatMap(f => onDisk(f) ?? [])

/** The author's frames of a stack, innermost first; on a platform that maps frames, already at their sources. */
export function userFrames(stack: string): Frame[] {
  const map = platform().frame
  const out: Frame[] = []
  for (const raw of framesOf(stack)) {
    const f = map ? map(raw) : onDisk(raw)
    if (f && isUserFile(f.file)) out.push(f)
  }
  return out
}

/** The stack of here, `depth` frames deep. */
export function stackHere(depth: number): string {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = depth
  const stack = new Error().stack ?? ''
  Error.stackTraceLimit = limit
  return stack
}

/** The innermost frame of the author's own code, at its source. */
export function callerSite(): Src | undefined {
  const raw = userFrames(stackHere(40)).find(f => /^([\\/]|[A-Za-z]:)/.test(f.file))
  if (!raw) return undefined
  const map = realm().mapSrc
  if (!map) return raw
  try {
    return map(raw)
  } catch {
    return raw
  }
}

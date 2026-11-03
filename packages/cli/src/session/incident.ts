// A view that fell out of sync: the incident under .pcbjs/log/<date>-desync.json, paths and references only, never file contents.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logDirOf, logOf } from './paths.js'

/** incidents kept of each kind */
export const KEEP_INCIDENTS = 20
/** what a view reports: the four conditions of session.md section 15 */
export type Condition = 'seq' | 'hash' | 'behind' | 'unknown'

export const CONDITIONS: Record<Condition, string> = {
  seq: 'a frame went missing',
  hash: 'a facet differs from the session’s at the same snapshot',
  behind: 'the view is older than the session with no compile on its way',
  unknown: 'an event names something the view does not hold',
}

/** This @pcbjs/cli's version, read where it runs. */
export function ownVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

const stamp = (d: Date) => d.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z'

/** Write one incident, the oldest of its kind beyond KEEP_INCIDENTS removed; the path written. */
export function writeIncident(root: string, kind: string, body: object, at = new Date()): string {
  const dir = logDirOf(root)
  mkdirSync(dir, { recursive: true })
  const base = `${stamp(at)}-${kind}`
  let file = join(dir, `${base}.json`)
  for (let n = 2; existsSync(file); n++) file = join(dir, `${base}-${n}.json`)
  writeFileSync(file, JSON.stringify({ kind, at: at.toISOString(), ...body }, null, 2) + '\n')
  const mine = incidents(root, kind)
  for (const f of mine.slice(0, Math.max(0, mine.length - KEEP_INCIDENTS))) rmSync(join(dir, f), { force: true })
  try {
    appendFileSync(logOf(root), `[pcbjs] ${at.toISOString()} ${kind} incident ${file}\n`)
  } catch {
    /* the log is the session's to make */
  }
  return file
}

/** The incident files of a kind, oldest first. */
export function incidents(root: string, kind = 'desync'): string[] {
  const dir = logDirOf(root)
  if (!existsSync(dir)) return []
  const re = new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\dZ-${kind}(-\\d+)?\\.json$`)
  return readdirSync(dir)
    .filter(f => re.test(f))
    .sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1))
}
// a second suffix sorts after the first file of its second
const order = (f: string) => Date.parse(f.slice(0, 19).replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3') + 'Z')

export const readIncident = (root: string, file: string): string => readFileSync(join(logDirOf(root), file), 'utf8')

/** The issue the Report button opens, prefilled; GitHub takes about 8 kB of URL, so a long incident is cut and names its file. */
export function issueUrl(text: string, file: string): string {
  const max = 6000
  const body = [
    'A view of the pcbjs dev server fell out of sync with the session.',
    '',
    '```json',
    text.length > max ? text.slice(0, max) + '\n…' : text,
    '```',
    '',
    `The whole incident: ${file}`,
  ].join('\n')
  const q = new URLSearchParams({ title: 'View fell out of sync with the session', body, labels: 'desync' })
  return `https://github.com/pcbjs/pcbjs/issues/new?${q}`
}

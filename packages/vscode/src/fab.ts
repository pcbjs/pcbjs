// The Fabrication dialog's model: one card per board and target from the session's `pcbjs.check/1` report, the set on disk and the
// repository and editor state, each blocker with its icon, sentence and action. No vscode here; fab-panel.ts draws and acts.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { Action } from './tree-data'
import { git as gitCli, type Git } from './worktrees'

/** The fields of a `pcbjs.check/1` finding the dialog reads. */
export interface ReportFinding {
  id: string
  kind: 'drc' | 'erc'
  severity: 'error' | 'warning' | 'info'
  rule: string
  message: string
  src: { file: string; start: [number, number]; end: [number, number] }[]
}

export interface ReportBoard {
  name: string
  target: string | null
  entry: string
  status: 'ok' | 'fail'
  findings: ReportFinding[]
  counts: { drcErrors: number; unconnected: number; ercErrors: number } | null
}

/** Where `session/check { report: true }` says a board's set goes and what the board is built from; paths absolute. */
export interface SetInfo {
  name: string
  target: string | null
  rev: string | null
  entry: string
  dir: string
  zip: string | null
  files: string[]
}

export interface CheckValue {
  session?: string
  exitCode: number
  report: { boards: ReportBoard[]; diagnostics: { message: string; entry?: string }[] }
  sets: SetInfo[]
}

/** The set as the last `pcbjs build` left it. */
export interface OnDisk {
  zip: string | null
  size: number
  sha256: string | null
  mtime: number
  date: string | null
  rev: string | null
  /** the text of the STALE file a failed build leaves */
  stale: string | null
  selfCheck: 'passed' | 'failed' | null
}

/** The repository around a project: its root, the changed files, absolute, and the last commit's time in s; null outside git. */
export interface Repo {
  root: string
  changed: string[]
  head: number | null
}

export type FabAction =
  | { kind: 'finding'; label: string; board: string; target: string | null; id: string; file?: string; line?: number; col?: number; endLine?: number; endCol?: number }
  | { kind: 'findings'; label: string }
  | { kind: 'save'; label: string; file: string }
  | { kind: 'scm'; label: string }
  | { kind: 'rev'; label: string; file: string }
  | { kind: 'build'; label: string }
  | { kind: 'open'; label: string; file: string }

export interface Blocker {
  icon: string
  text: string
  action: FabAction
  /** a stale set alone makes the card STALE, any other blocker BLOCKED */
  stale?: boolean
}

export type Pill = 'ORDERABLE' | 'BLOCKED' | 'STALE'

export interface Card {
  key: string
  session?: string
  root: string
  name: string
  target: string | null
  pill: Pill
  zipName: string | null
  zip: string | null
  dir: string
  size: number
  sha256: string | null
  date: string | null
  dateSource: string
  blockers: Blocker[]
}

/** The findings named one by one before a line that opens the Findings view. */
export const SHOWN_FINDINGS = 6

const rel = (root: string, f: string) => path.relative(root, f) || path.basename(f)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The set on disk: the zip, its sha256, manifest.json, STALE and README-fab's self check line. */
export function readSet(s: SetInfo): OnDisk {
  const read = (name: string) => {
    try {
      return fs.readFileSync(path.join(s.dir, name), 'utf8')
    } catch {
      return null
    }
  }
  let zip: string | null = s.zip && fs.existsSync(s.zip) ? s.zip : null
  // a set built at another rev has another zip name
  if (!zip) {
    try {
      const found = fs.readdirSync(s.dir).find(f => f.endsWith('.zip'))
      if (found) zip = path.join(s.dir, found)
    } catch {}
  }
  let manifest: { date?: string; rev?: string | null } = {}
  try {
    manifest = JSON.parse(read('manifest.json') ?? '{}')
  } catch {}
  const self = /Gerber self check: (\w+)/.exec(read('README-fab.txt') ?? '')?.[1]
  const st = zip ? fs.statSync(zip) : null
  return {
    zip,
    size: st?.size ?? 0,
    sha256: zip ? createHash('sha256').update(fs.readFileSync(zip)).digest('hex') : null,
    mtime: st?.mtimeMs ?? 0,
    date: manifest.date ?? null,
    rev: manifest.rev ?? null,
    stale: read('STALE'),
    selfCheck: self === 'passed' ? 'passed' : self ? 'failed' : null,
  }
}

/** The repository holding root, null outside one or without git. */
export async function readRepo(root: string, run: Git = gitCli): Promise<Repo | null> {
  let top: string
  try {
    top = (await run(root, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return null
  }
  const status = await run(top, ['status', '--porcelain', '-z', '--untracked-files=all']).catch(() => '')
  const changed: string[] = []
  const parts = status.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i]
    if (l.length < 4) continue
    changed.push(path.join(top, l.slice(3)))
    // a rename or copy names its source next
    if (/^[RC]/.test(l)) i++
  }
  const ct = Number((await run(top, ['log', '-1', '--format=%ct']).catch(() => '')).trim())
  return { root: fs.realpathSync(top), changed: changed.map(f => real(f)), head: Number.isFinite(ct) && ct > 0 ? ct : null }
}

const real = (f: string) => {
  try {
    return fs.realpathSync(f)
  } catch {
    return f
  }
}

/** The newest mtime among the board's own files, those outside node_modules, with the file. */
function newest(files: string[]): { file: string; mtime: number } | null {
  let best: { file: string; mtime: number } | null = null
  for (const f of files) {
    if (f.includes(`${path.sep}node_modules${path.sep}`)) continue
    try {
      const m = fs.statSync(f).mtimeMs
      if (!best || m > best.mtime) best = { file: f, mtime: m }
    } catch {}
  }
  return best
}

export const fileOf = (root: string, src: ReportFinding['src'][number]) => path.resolve(root, src.file)

function findingBlockers(root: string, b: ReportBoard): Blocker[] {
  const errors = b.findings.filter(f => f.severity === 'error')
  const icon = (f: ReportFinding) => (f.kind === 'erc' ? 'symbol-event' : f.rule === 'unconnected' ? 'debug-disconnect' : 'error')
  const out: Blocker[] = errors.slice(0, SHOWN_FINDINGS).map(f => {
    const s = f.src[0]
    const at = s ? { file: fileOf(root, s), line: s.start[0], col: s.start[1], endLine: s.end[0], endCol: s.end[1] } : {}
    return {
      icon: icon(f),
      text: `${f.kind.toUpperCase()} ${f.rule}: ${f.message}`,
      action: { kind: 'finding', label: 'Open the finding', board: b.name, target: b.target, id: f.id, ...at },
    }
  })
  if (errors.length > SHOWN_FINDINGS)
    out.push({
      icon: 'list-unordered',
      text: `${plural(errors.length - SHOWN_FINDINGS, 'more error')} block the set.`,
      action: { kind: 'findings', label: 'Open the Findings view' },
    })
  return out
}

/** Why the set on disk is not the board's: missing, marked STALE, of another rev or older than a file of the board. */
function staleBlocker(s: SetInfo, d: OnDisk): Blocker | null {
  const build = { kind: 'build' as const, label: 'Build' }
  if (!d.zip) return { icon: 'package', text: 'No fab set is built yet.', action: build, stale: true }
  if (d.stale) return { icon: 'history', text: 'The last build of this board failed, so the set is from an earlier one.', action: build, stale: true }
  if (d.rev !== s.rev) {
    const text = !d.rev ? `The set was built without a rev, the board is ${s.rev}.` : `The set is of rev ${d.rev}, the board ${s.rev ? `is ${s.rev}` : 'has none'}.`
    return { icon: 'history', text, action: build, stale: true }
  }
  const n = newest(s.files)
  if (n && n.mtime > d.mtime) return { icon: 'history', text: `${path.basename(n.file)} changed after the set was built.`, action: build, stale: true }
  return null
}

/** The sentence after the date: where the build took it from. */
export function dateSource(date: string | null, head: number | null): string {
  if (!date) return 'no set'
  if (head !== null && Date.parse(date) === head * 1000) return 'the last commit, through SOURCE_DATE_EPOCH'
  return 'not the last commit: the build time or --date'
}

export interface CardInput {
  root: string
  set: SetInfo
  board: ReportBoard
  disk: OnDisk
  /** unsaved files open in the editor, absolute */
  dirty: string[]
  repo: Repo | null
}

export function card(i: CardInput): Card {
  const { root, set: s, board: b, disk: d, repo } = i
  const files = new Set(s.files.map(real))
  const blockers: Blocker[] = [...findingBlockers(root, b)]
  for (const f of i.dirty.filter(f => files.has(real(f))))
    blockers.push({ icon: 'circle-filled', text: `${rel(root, f)} has unsaved changes the set would not include.`, action: { kind: 'save', label: 'Save', file: f } })
  const changed = repo ? repo.changed.filter(f => files.has(f)) : []
  if (changed.length)
    blockers.push({
      icon: 'git-commit',
      text: `${plural(changed.length, 'file')} of the board ${changed.length === 1 ? 'is' : 'are'} not committed: ${changed.map(f => rel(root, f)).join(', ')}.`,
      action: { kind: 'scm', label: 'Open source control' },
    })
  if (!s.rev) blockers.push({ icon: 'tag', text: 'The board has no rev, so the zip is a dev set no fab order can name.', action: { kind: 'rev', label: 'Add rev', file: s.entry } })
  if (d.selfCheck === 'failed')
    blockers.push({
      icon: 'beaker',
      text: 'The Gerber self check of the set failed: the Gerbers do not read back as the board.',
      action: { kind: 'open', label: 'Open README-fab', file: path.join(s.dir, 'README-fab.txt') },
    })
  const stale = staleBlocker(s, d)
  if (stale) blockers.push(stale)
  const pill: Pill = blockers.some(x => !x.stale) ? 'BLOCKED' : stale ? 'STALE' : 'ORDERABLE'
  return {
    key: `${root}|${s.name}|${s.target ?? ''}`,
    root,
    name: s.name,
    target: s.target,
    pill,
    zipName: d.zip ? path.basename(d.zip) : s.zip ? path.basename(s.zip) : null,
    zip: d.zip,
    dir: s.dir,
    size: d.size,
    sha256: d.sha256,
    date: d.date,
    dateSource: dateSource(d.date, repo?.head ?? null),
    blockers,
  }
}

/** Every card of a project, in the report's order. */
export function cards(root: string, v: CheckValue, dirty: string[], repo: Repo | null, read: (s: SetInfo) => OnDisk = readSet): Card[] {
  return v.sets.flatMap(s => {
    const board = v.report.boards.find(b => b.name === s.name && b.target === s.target)
    return board ? [card({ root, set: s, board, disk: read(s), dirty, repo })] : []
  })
}

/** `rev="0.1.0"` after `<PCB` in the text, the offset and the insert; null when the text has no `<PCB`. */
export function revInsert(text: string, rev = '0.1.0'): { offset: number; text: string } | null {
  const m = /<PCB\b/.exec(text)
  return m ? { offset: m.index + m[0].length, text: ` rev="${rev}"` } : null
}

export const sizeText = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} kB` : `${n} B`)

/** Preserve the card's captured owner when a blocker opens the preview and source. */
export function fabFindingAction(a: Extract<FabAction, { kind: 'finding' }>, origin: { root: string; session?: string }): Action {
  return {
    kind: 'finding', session: origin.session ?? 'disconnected', project: origin.root,
    board: a.board, target: a.target, id: a.id,
    ...(a.file ? { source: { file: a.file, line: a.line ?? 1, col: a.col ?? 1, endLine: a.endLine ?? a.line ?? 1, endCol: a.endCol ?? a.col ?? 1 } } : {}),
  }
}

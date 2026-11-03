// The report of a compile: each board's line, findings and diagnostics, the JSON of `--json`, and the snapshot identity.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { ResolvedConfig } from './config.js'
import { errorText, strip } from './compile.js'
import type { BoardOut, Compiled } from './project.js'
import type { BoardSlot } from './boards.js'
import {
  boardFindings,
  boardLine,
  counts,
  routingLines,
  failing,
  formatFindings,
  orderFindings,
  type Finding,
  type SourceRef,
  type TargetFindings,
} from '@pcbjs/export/internal/findings'
import type { Src } from '@pcbjs/core/internal/types'
import { installedPackages } from './installed.js'
import { variantSlug } from '@pcbjs/core/internal/variants'
import { countModels } from '@pcbjs/core/internal/model-source'
import { typecheck, typeErrorLine } from './typecheck.js'
import type { CycleError } from '@pcbjs/compile/internal/deps'

/** One per target of a board with variants. */
export interface ReportBoard {
  name: string
  target: string | null
  entry: string
  status: 'ok' | 'fail' | 'error'
  /** 16 hex over the board's final output, the snapshot identity */
  snapshot: string | null
  stats: Compiled['board']['stats'] | null
  /** absent on a board without automatic routes */
  routing?: Compiled['board']['routing']
  stages: { name: string; ms: number; hit: boolean }[]
  findings: Finding[]
  fab: { dir: string; zip: string } | null
  counts: ReturnType<typeof counts> | null
  /** see docs/schematic-graphic.md */
  schematic?: import('@pcbjs/core/internal/sch-model').SchStats
  /** parts by where their 3D body comes from */
  models?: ReturnType<typeof countModels>
  /** build only: the site pages of the board */
  pages?: string[]
}
/** A compile, type, config, reference, cycle or plugin error; never a finding. */
export interface Diagnostic {
  kind: 'compile' | 'type' | 'config' | 'reference' | 'cycle' | 'plugin'
  code: string
  severity: 'error' | 'warning'
  message: string
  entry?: string
  src?: SourceRef
}
/** What `check --json` and `build --json` write, once, after the typecheck. */
export interface CheckReport {
  schema: 'pcbjs.check/1'
  command: 'check' | 'build' | 'test'
  result: 'ok' | 'fail' | 'error'
  exit: 0 | 1
  ms: number
  versions: Record<string, string>
  boards: ReportBoard[]
  diagnostics: Diagnostic[]
  typecheck: { status: 'ok' | 'errors' | 'skipped'; errors: number; cached: boolean; ms: number }
  cache: { stages: number; hits: number }
  /** the board tests of `check --test` and `pcbjs test` */
  tests?: TestReport
}

/** The board tests of one run, docs/testing.md. */
export interface TestReport {
  status: 'ok' | 'fail' | 'skipped'
  passed: number
  failed: number
  ms: number
  results: { name: string; file: string | null; ok: boolean; ms: number; error?: string }[]
}

const sha16 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)
/** The board as a warm and a cold compile both leave it: the router's own counts left out. */
const canonical = (b: Compiled['board']) => JSON.stringify({ ...b, routing: b.routing && { ...b.routing, cached: undefined, ripped: undefined, rounds: undefined } })
/** The board's snapshot identity: a hash of the board as a warm and a cold compile both leave it. */
export const snapshotOf = (b: Compiled['board']): string => sha16(canonical(b))

/** The compiled boards of one entry; a failed entry has none and is a diagnostic. */
export function reportOf(cfg: ResolvedConfig, s: ReportSlot, extra: { fab?: (c: BoardOut) => { dir: string; zip: string } | null; pages?: string[] } = {}): ReportBoard[] {
  const rel = (p: string) => relative(cfg.root, p) || '.'
  if (!s.compiled || s.conflict) return []
  return s.compiled.map(c => {
    const b = c.board
    const slug = b.variant ? variantSlug(b.variant.name) : null
    const fab = extra.fab?.(c) ?? null
    return {
      name: b.name,
      target: b.variant?.name ?? null,
      entry: c.entry.rel,
      status: failing(b) ? 'fail' : 'ok',
      snapshot: snapshotOf(b),
      stats: b.stats,
      ...(b.routing ? { routing: b.routing } : {}),
      stages: c.stages.map(st => ({ name: st.name, ms: Math.round(st.ms * 10) / 10, hit: !!st.hit })),
      findings: orderFindings(boardFindings(b, cfg.root)),
      fab: fab ? { dir: rel(fab.dir), zip: rel(fab.zip) } : null,
      counts: counts(b),
      ...(b.schematic.drawing ? { schematic: b.schematic.drawing.stats } : {}),
      models: countModels(c.site.footprints),
      ...(extra.pages ? { pages: extra.pages.filter(p => p === `board/${b.name}` || (slug ? p === `board/${b.name}/${slug}` : false)) } : {}),
    }
  })
}

/** What kind of error stopped an entry, by its message. */
function errorKind(e: unknown, conflict: string | null): Pick<Diagnostic, 'kind' | 'code'> {
  if (conflict) return { kind: 'config', code: 'board-name' }
  // by name, never instanceof: the error may come from another copy of the compiler
  if ((e as { name?: string })?.name === 'CycleError') return { kind: 'cycle', code: (e as CycleError).code }
  const m = String((e as { message?: unknown })?.message ?? e)
  if (/^reference\(|references nest/.test(m)) return { kind: 'reference', code: 'reference-error' }
  if (/^plugin "/.test(m)) return { kind: 'plugin', code: 'plugin-error' }
  const code = (e as { code?: unknown })?.code
  if (typeof code === 'string' && /^[a-z]+(-[a-z]+)+$/.test(code)) return { kind: 'compile', code }
  return { kind: 'compile', code: (e as { name?: string })?.name === 'SyntaxError' ? 'syntax-error' : 'compile-error' }
}

/** The diagnostic of an entry that failed to compile, none for one that compiled. */
export function slotDiagnostics(cfg: ResolvedConfig, s: ReportSlot, e: unknown): Diagnostic[] {
  if (s.compiled && !s.conflict) return []
  const src = (e as { src?: Src })?.src
  return [
    {
      ...errorKind(e, s.conflict),
      severity: 'error',
      message: s.conflict ?? errorText(e, false, cfg.root).line,
      entry: s.entry.rel,
      ...(src?.file
        ? { src: { file: relative(cfg.root, resolve(cfg.root, src.file)), start: [src.line, src.col], end: [src.endLine ?? src.line, src.endCol ?? src.col], role: 'item' } }
        : {}),
    },
  ]
}

/** Each type error as a diagnostic, its `src` the position tsc gave. */
export function typeDiagnostics(tc: ReturnType<typeof typecheck>): Diagnostic[] {
  return (tc?.errors ?? []).map(t => {
    const m = /^(.*):(\d+):(\d+)$/.exec(t.src)
    return {
      kind: 'type' as const,
      code: `TS${t.code}`,
      severity: 'error' as const,
      message: t.message,
      ...(m ? { src: { file: m[1], start: [Number(m[2]), Number(m[3])] as [number, number], end: [Number(m[2]), Number(m[3])] as [number, number], role: 'item' as const } } : {}),
    }
  })
}

/** The installed @pcbjs packages and Node. */
export function reportVersions(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of installedPackages(root)) out[p.name] = p.version
  out.node = process.version
  return out
}

/** The report of one run, over every entry and the typecheck. */
export function checkReport(
  cfg: ResolvedConfig,
  command: CheckReport['command'],
  slots: ReportSlot[],
  errorOf: (s: ReportSlot) => unknown,
  tc: ReturnType<typeof typecheck> | 'skipped',
  ms: number,
  extra: Parameters<typeof reportOf>[2] = {},
): CheckReport {
  const boards = slots.flatMap(s => reportOf(cfg, s, extra))
  const types = tc === 'skipped' ? [] : typeDiagnostics(tc)
  const diagnostics = [...slots.flatMap(s => slotDiagnostics(cfg, s, errorOf(s))), ...types]
  const result = diagnostics.some(d => d.kind !== 'type') ? 'error' : types.length || boards.some(b => b.status === 'fail') ? 'fail' : 'ok'
  const keyed = slots.flatMap(s => (s.compiled ?? []).flatMap(c => c.stages.filter(st => st.key)))
  return {
    schema: 'pcbjs.check/1',
    command,
    result,
    exit: result === 'ok' ? 0 : 1,
    ms: Math.round(ms),
    versions: reportVersions(cfg.root),
    boards,
    diagnostics,
    typecheck:
      tc === 'skipped' || !tc
        ? { status: 'skipped', errors: 0, cached: false, ms: 0 }
        : { status: tc.errors.length ? 'errors' : 'ok', errors: tc.errors.length, cached: tc.cached, ms: Math.round(tc.ms) },
    cache: { stages: keyed.length, hits: keyed.filter(st => st.hit).length },
  }
}

/** A run that stopped before any entry compiled, such as on a config error. */
export function failedReport(command: CheckReport['command'], root: string, e: unknown, ms: number): CheckReport {
  return {
    schema: 'pcbjs.check/1',
    command,
    result: 'error',
    exit: 1,
    ms: Math.round(ms),
    versions: reportVersions(root),
    boards: [],
    diagnostics: [{ kind: 'config', code: 'config-error', severity: 'error', message: strip(String((e as Error)?.message ?? e)).split('\n')[0] }],
    typecheck: { status: 'skipped', errors: 0, cached: false, ms: 0 },
    cache: { stages: 0, hits: 0 },
  }
}

export function writeReport(root: string, file: string, report: CheckReport): string {
  const abs = resolve(root, file)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(report, null, 2) + '\n')
  return relative(root, abs) || abs
}

/** A line per target, then the findings of every target merged, at most `cap` lines per rule; every one with `verbose`; each stage's cache outcome with `cache`. */
export function slotLines(s: ReportSlot, e: unknown, o: { root: string; cap: number; verbose?: boolean; more?: string; cache?: boolean }): string[] {
  if (s.conflict) return [`${s.entry.rel}  error: ${s.conflict}`]
  if (!s.compiled) {
    const t = errorText(e, o.verbose, o.root)
    return [`${s.entry.rel}  compile error: ${t.line}`, ...t.detail.map(l => `  ${l}`)]
  }
  const out = s.compiled.map(c => boardLine(c.board, c.entry.rel, c.ms))
  if (o.verbose) out.push(...s.compiled.flatMap(stageLines))
  if (o.cache) out.push(...s.compiled.flatMap(cacheLines))
  out.push(...routingLines(s.compiled.map(c => c.board)))
  const targets: TargetFindings[] = s.compiled.map(c => ({ target: c.board.variant?.name, findings: boardFindings(c.board, o.root) }))
  out.push(...formatFindings(targets, { cap: o.cap, more: o.more, all: o.verbose }))
  return out
}

/** One line per stage with its time, or `hit` when its output came from the cache, the target named on a board with variants, then the lines the stage logged. */
export function stageLines(c: Pick<Compiled, 'board' | 'stages'>): string[] {
  const of = c.board.variant ? `  [${c.board.variant.name}]` : ''
  const width = Math.max(0, ...c.stages.map(s => s.name.length))
  const time = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`
  return c.stages.flatMap(s => [`  stage  ${s.name.padEnd(width)}  ${s.hit ? 'hit' : time(s.ms)}${of}`, ...(s.log ?? []).map(l => `    ${l}`)])
}

/** `check --cache`: each keyed stage as a hit or a miss with the first 12 hex of its key, as `make -n` tells what it would rebuild. */
export function cacheLines(c: Pick<Compiled, 'board' | 'stages'>): string[] {
  const of = c.board.variant ? `  [${c.board.variant.name}]` : ''
  const keyed = c.stages.filter(s => s.key)
  const width = Math.max(0, ...keyed.map(s => s.name.length))
  return keyed.map(s => `  cache  ${s.name.padEnd(width)}  ${s.hit ? 'hit ' : 'miss'}  ${s.key!.slice(0, 12)}${of}`)
}

/** Every board's counts added up. */
export function totalLine(slots: ReportSlot[]): string {
  let de = 0,
    dw = 0,
    un = 0,
    ee = 0,
    ew = 0,
    bad = 0,
    failed = 0
  for (const s of slots) {
    if (!s.compiled || s.conflict) {
      failed++
      continue
    }
    for (const c of s.compiled) {
      const k = counts(c.board)
      de += k.drcErrors
      dw += k.drcWarnings
      un += k.unconnected
      ee += k.ercErrors
      ew += k.ercWarnings
      if (failing(c.board)) bad++
    }
  }
  const ok = !bad && !failed
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  return `${ok ? 'ok  ' : 'FAIL'}  DRC ${n(de, 'error')}, ${n(dw, 'warning')}, ${un} unconnected  ERC ${n(ee, 'error')}, ${n(ew, 'warning')}${failed ? `  ${failed} entr${failed === 1 ? 'y' : 'ies'} failed to compile` : ''}`
}

export const slotsFailed = (slots: ReportSlot[]): boolean => slots.some(s => !s.compiled || s.conflict || s.compiled.some(c => failing(c.board)))

/** Mark a failed entry's outputs stale: its board JSON gets `stale: true` and the error, each fab directory a STALE file. */
export function markStale(cfg: ResolvedConfig, entry: string, error: string): string[] {
  const index = join(cfg.outDir, 'boards.json')
  if (!existsSync(index)) return []
  let boards: { name: string; variant?: string; file: string; entry: string }[] = []
  try {
    boards = JSON.parse(readFileSync(index, 'utf8')).boards ?? []
  } catch {
    return []
  }
  const marked: string[] = []
  const note = `STALE: the last compile of ${entry} failed, these files are from an earlier build.\n${error}\n`
  for (const b of boards.filter(b => b.entry === entry)) {
    const file = join(cfg.outDir, ...b.file.split('/').map(decodeURIComponent))
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'))
        writeFileSync(file, JSON.stringify({ ...data, stale: true, staleError: error }))
        marked.push(relative(cfg.root, file))
      } catch {
        /* not ours */
      }
    }
    const segs = [b.name, ...(b.variant ? [variantSlug(b.variant)] : [])]
    for (const dir of [join(cfg.fabDir, ...segs), join(cfg.outDir, 'fab', ...segs)]) {
      if (!existsSync(dir)) continue
      writeFileSync(join(dir, 'STALE'), note)
      marked.push(relative(cfg.root, join(dir, 'STALE')))
    }
  }
  return marked
}

export const CHECK_CAP = 10

/** An entry as a report reads it, from a check's own compile or a session's snapshot. */
export type ReportSlot = Pick<BoardSlot<BoardOut>, 'entry' | 'compiled' | 'conflict'>

/** What `pcbjs check` prints for the boards: their lines and findings, then the total. */
export function checkLines(root: string, slots: ReportSlot[], errorOf: (s: ReportSlot) => unknown, o: { verbose?: boolean; json?: string; cache?: boolean }): string[] {
  const more = o.json ? `all in ${o.json}` : 'all with --verbose or --json <file>'
  return [...slots.flatMap(s => slotLines(s, errorOf(s), { root, cap: CHECK_CAP, verbose: o.verbose, cache: o.cache, more })), totalLine(slots)]
}

/** The typecheck line and its errors, nothing without a tsconfig.json. */
export function typecheckLines(tc: ReturnType<typeof typecheck>, verbose?: boolean): string[] {
  if (!tc) return []
  const n = tc.errors.length
  return [
    `typecheck  ${n ? `${n} error${n === 1 ? '' : 's'}` : 'ok'}  ${Math.round(tc.ms)} ms${tc.cached ? ', cached' : ''}`,
    ...tc.errors.slice(0, 20).map(e => typeErrorLine(e, verbose)),
    ...(n > 20 ? [`  and ${n - 20} more, all with npx tsc --noEmit`] : []),
  ]
}

// `pcbjs test` and `check --test`: every *.test.ts under the project through node --test, against one snapshot written to .pcbjs/test/<snapshot>/
// by the session when one is live, else by a compile here; `--update` writes the goldens first.
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import type { ResolvedConfig } from './project/config.js'
import type { Compiled } from './project/project.js'
import { reportVersions, writeReport, type CheckReport, type TestReport } from './project/report.js'
import { compileHere } from './project/local.js'
import { writeGolden } from './project/golden.js'
import { writeTestDir } from './project/test-dir.js'
import { ask, sessionLine, sessionOf } from './session/thin.js'
import type { Envelope } from '@pcbjs/core/protocol'

/** The tests of a report: each one that ended. */
export interface TestOptions {
  files?: string[]
  update?: boolean
  fresh?: boolean | 'all'
  verbose?: boolean
}

const SKIP = new Set(['node_modules', '.pcbjs', '.git', 'dist'])

/** Every `*.test.ts`, `.mts` and `.tsx` under the root outside node_modules, .pcbjs, .git and dist. */
export function testFiles(root: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(join(d, e.name))
      } else if (/\.test\.(m?ts|tsx)$/.test(e.name)) out.push(join(d, e.name))
    }
  }
  walk(root)
  return out.sort()
}

/** The snapshot's boards on disk: the session's when one is live, else compiled here; the entries that failed are named. */
async function snapshotDir(cfg: ResolvedConfig, root: string, o: TestOptions): Promise<{ dir: string; failed: string[] }> {
  const info = o.fresh ? null : await sessionOf(root)
  if (info) {
    const e = await ask(info, 'pcbjs test', root, 'session/test', { project: root })
    console.error(sessionLine(info, e))
    return e.value
  }
  const here = await compileHere(cfg, { verbose: o.verbose, fresh: o.fresh })
  for (const l of here.errors) console.error(l)
  const dir = await writeTestDir(root, here.snapshot, here.boards, c => (c as Compiled).fab)
  return { dir, failed: here.errors }
}

/** Replace each golden folder with the board's fab set of the snapshot. */
function updateGoldens(root: string, dir: string): void {
  for (const f of readdirSync(dir).filter(f => f.endsWith('.fab.json'))) {
    const key = f.slice(0, -'.fab.json'.length)
    const names = writeGolden(join(root, 'golden', key), JSON.parse(readFileSync(join(dir, f), 'utf8')))
    console.log(`golden  golden/${key}/  ${names.length} files`)
  }
}

const GOLDEN = new URL('./test-golden.js', import.meta.url)
const REGISTER = new URL('./test-register.js', import.meta.url)
const REPORTER = new URL('./test-reporter.js', import.meta.url)

/** Run the tests, the spec reporter on stdout; exit 0 when every one passed, 1 otherwise. */
export async function runTests(cfg: ResolvedConfig, o: TestOptions = {}): Promise<{ exit: number; report: TestReport }> {
  const t0 = performance.now()
  const root = realpathSync(cfg.root)
  const files = o.files?.length ? o.files.map(f => resolve(f)) : testFiles(root)
  const goldens = existsSync(join(root, 'golden')) || !!o.update
  if (!files.length && !goldens) {
    console.log(`test  no *.test.ts under ${root} and no golden/`)
    return { exit: 0, report: { status: 'skipped', passed: 0, failed: 0, ms: 0, results: [] } }
  }
  const { dir, failed } = await snapshotDir(cfg, root, o)
  if (o.update) updateGoldens(root, dir)
  const out = mkdtempSync(join(tmpdir(), 'pcbjs-test-'))
  const results = join(out, 'results.jsonl')
  const args = [
    '--test',
    '--import',
    REGISTER.href,
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    `--test-reporter=${REPORTER.href}`,
    `--test-reporter-destination=${results}`,
    ...files.map(f => relative(root, f) || f),
    ...(goldens ? [fileURLToPath(GOLDEN)] : []),
  ]
  const code = await new Promise<number>(done => {
    // a run inside another node --test would report to that one instead of printing
    const { NODE_TEST_CONTEXT: _, ...env } = process.env
    const p = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: { ...env, PCBJS_TEST_DIR: dir, PCBJS_TEST_ROOT: root } })
    p.on('exit', c => done(c ?? 1))
    p.on('error', () => done(1))
  })
  const list: TestReport['results'] = existsSync(results)
    ? readFileSync(results, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l))
        .map(r => ({ ...r, file: r.file ? relative(root, r.file.startsWith('file:') ? fileURLToPath(r.file) : r.file) : null }))
    : []
  rmSync(out, { recursive: true, force: true })
  const bad = list.filter(r => !r.ok).length
  const exit = code || bad || failed.length ? 1 : 0
  return { exit, report: { status: exit ? 'fail' : 'ok', passed: list.length - bad, failed: bad, ms: Math.round(performance.now() - t0), results: list } }
}

/** `check --test --json`: the tests join the report the check wrote, a failed one failing it. */
export function addTests(root: string, file: string, tests: TestReport): void {
  const abs = resolve(root, file)
  const r = JSON.parse(readFileSync(abs, 'utf8')) as CheckReport
  const failed = tests.status === 'fail'
  writeReport(root, file, { ...r, tests, ...(failed && r.result === 'ok' ? { result: 'fail', exit: 1 } : {}) })
}

/** `pcbjs test --json`: a report of the tests alone. */
export function testReport(root: string, tests: TestReport): CheckReport {
  const exit = tests.status === 'fail' ? 1 : 0
  return {
    schema: 'pcbjs.check/1',
    command: 'test',
    result: exit ? 'fail' : 'ok',
    exit,
    ms: tests.ms,
    versions: reportVersions(root),
    boards: [],
    diagnostics: [],
    typecheck: { status: 'skipped', errors: 0, cached: false, ms: 0 },
    cache: { stages: 0, hits: 0 },
    tests,
  }
}

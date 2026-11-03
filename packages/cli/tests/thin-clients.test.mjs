// check and inspect as thin clients of a session: stdout and exit code equal to the run in process over copies of the demo and highspeed,
// timings aside, the session line on stderr; and q naming every board a reference is on.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/** The example in a folder of its own, its stage and route caches kept so both runs are warm. */
function copy(example) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `pcbjs-thin-${example}-`)))
  dirs.push(root)
  const from = join(REPO, 'examples', example)
  cpSync(from, root, {
    recursive: true,
    filter: f => !/\/(node_modules|dist)(\/|$)/.test(f.slice(from.length)) && !/\/\.pcbjs\/(dev\.json|session|log|test)/.test(f.slice(from.length)),
  })
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  return root
}

const run = (root, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 300000 })
// what differs between two runs of one input: the times, and what came from a cache, tsc's answer and each stage of --verbose
const noMs = s =>
  s
    .replace(/\d+(\.\d+)? (ms|s)\b/g, 'T')
    .replace(/, cached$/gm, '')
    .replace(/^  stage  .*\n/gm, '')

async function serve(root) {
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  const t0 = Date.now()
  while (!/\[pcbjs\] session \w+, pid/.test(out)) {
    if (Date.now() - t0 > 60000) throw new Error(`no session:\n${out}`)
    await new Promise(r => setTimeout(r, 50))
  }
  return {
    info: JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8')),
    stop: async () => {
      await stop(child)
    },
  }
}

const CASES = {
  demo: [
    ['check'],
    ['check', 'coin.pcb.tsx'],
    ['inspect', 'blinky.pcb.tsx'],
    ['inspect', 'blinky.pcb.tsx', 'R1', 'net:GND', '--lengths'],
    ['inspect', 'multi.pcb.tsx', 'R1', '-t', 'House', '--json'],
    ['inspect', 'quad.pcb.tsx', 'NOPE'],
  ],
  highspeed: [['check'], ['check', '--verbose'], ['inspect'], ['inspect', '--lengths'], ['inspect', '--layer', 'F.Cu']],
}

for (const [example, cases] of Object.entries(CASES))
  test(`${example}: check and inspect print the same through a session as in process`, { timeout: 600000 }, async () => {
    const root = copy(example)
    // warm both caches first, so neither run routes
    run(root, 'check')
    const here = cases.map(args => run(root, ...args))
    const s = await serve(root)
    try {
      for (const [i, args] of cases.entries()) {
        const via = run(root, ...args)
        assert.match(via.stderr, new RegExp(`^session ${s.info.session}  snapshot ${s.info.session}\\.\\d+; --fresh compiles here$`, 'm'), args.join(' '))
        assert.equal(noMs(via.stdout), noMs(here[i].stdout), args.join(' '))
        assert.equal(via.status, here[i].status, args.join(' '))
      }
      if (example === 'demo') {
        const q = run(root, 'q', 'R1')
        assert.equal(q.status, 2)
        assert.deepEqual(JSON.parse(q.stdout).value.candidates, ['board:Blinky/R1', 'board:Quad/R1', 'board:Multi/R1'])
        assert.equal(JSON.parse(run(root, 'q', 'R1', '--board', 'Quad').stdout).value.board, 'Quad')
      }
    } finally {
      await s.stop()
    }
  })

// A route a circuit build binds and returns, `const vccTrunk = route(…)`, is the instance handle `ch2.vccTrunk`: its `.end` routes and
// type checks as a route end, and check, inspect and q answer `CH2/route:vccTrunk/pt:1`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const SCH = `import { circuit, nets, route, type Ports } from '@pcbjs/core'
import { R0603, LED0603, PinHeader } from '@pcbjs/lib'

export const chan = circuit('chan', ({ VCC, SW }: Ports<'VCC' | 'SW'>, { nets: { led } }) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: led })
  const D01 = LED0603('green').connect({ A: led, K: SW })
  const vccTrunk = route('2 0').net(VCC).width(0.3).H(4.175)
  return { R01, D01, vccTrunk }
})

export const { VCC, SW, GND } = nets()
export const J1 = PinHeader(3)().connect({ 1: GND, 2: VCC, 3: SW })
export const ch2 = chan({ VCC, SW }, 'CH2')
`

const BOARD = `import PCB, { layout, route } from '@pcbjs/core'
import { chan, ch2, J1 } from './pts.sch'

const Row = layout(chan, (g, { at }) => (
  <g at={at}>
    <g.R01 at="5 0" />
    <g.D01 at="10 0 180deg" />
    {g.vccTrunk}
    {route(g.R01[2], g.D01.A).width(0.3)}
  </g>
), 'Row')

export default (
  <PCB name="Pts">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <J1 at="20 8" />
    <Row g={ch2} at="0 5" />
    {route(J1[2], ch2.vccTrunk.end).width(0.3)}
    {route(J1[3], ch2.D01.K).width(0.3)}
  </PCB>
)
`

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-pts-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        jsxImportSource: '@pcbjs/core',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      include: ['*.ts', '*.tsx'],
    }),
  )
  writeFileSync(join(root, 'pts.sch.ts'), SCH)
  writeFileSync(join(root, 'pcb.tsx'), BOARD)
  return root
}

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, env: { ...process.env, XDG_RUNTIME_DIR: join(root, '.run') }, encoding: 'utf8', timeout: 240000 })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('ch2.vccTrunk.end as a route end: check type checks and routes it, inspect and q answer CH2/route:vccTrunk/pt:1', { timeout: 300000 }, () => {
  const root = project()
  const check = run(root, 'check')
  assert.equal(check.code, 0, check.out)
  assert.match(check.out, /typecheck {2}ok/)
  const pt = run(root, 'inspect', '--fresh', 'CH2/route:vccTrunk/pt:1')
  assert.equal(pt.code, 0, pt.out)
  assert.match(pt.out, /CH2\/route:vccTrunk\/pt:1 {2}at \(4\.18, 5\.00\)/)
  const lengths = run(root, 'inspect', '--fresh', '--lengths')
  assert.match(lengths.out, /CH2\/route:vccTrunk/)
  const q = run(root, 'q', 'route:vccTrunk/pt:1', '--fresh')
  assert.equal(q.code, 0, q.out)
  assert.match(q.out, /"ref": ?"CH2\/route:vccTrunk\/pt:1"/)
})

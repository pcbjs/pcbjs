// <PCB schematic={sch}> with a module namespace: the drawing it holds, the names of its parts, and the bare names a design
// file uses from it, at run time through the CLI and in the type check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import PCB, { h, nets, Schematic, Sym } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'
import { scopeHost, sourcePosition } from '@pcbjs/compile/scope'
import { BoardIndex, refsText } from '@pcbjs/export/findings'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const cli = join(repo, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })

function module() {
  const { VCC, GND } = nets()
  const R1 = R0603('1k').ref('R1').connect(VCC, GND)
  const Rpull = R0603('10k').connect(VCC, GND)
  return { VCC, GND, R1, Rpull }
}
const place = m => [edge(), h(m.R1, { at: '5 5' }), h(m.Rpull, { at: '10 5' })]
const auto = b => b.schematic.drawing.symbols.find(s => s.ref === 'R1').auto

test('schematic namespace: the drawing is `drawing`, then `default`, then any export that is one, else drawn by the compiler', () => {
  const m = module()
  const sheet = () => h(Schematic, {}, h(Sym, { part: m.R1, at: '4 7' }))
  const other = h(Schematic, { title: 'other' })
  assert.equal(auto(compileBoard(h(PCB, { name: 'A', schematic: { ...m } }, ...place(m)))), true)
  assert.equal(auto(compileBoard(h(PCB, { name: 'B', schematic: { ...m, drawing: sheet(), default: other } }, ...place(m)))), false)
  assert.equal(auto(compileBoard(h(PCB, { name: 'C', schematic: { ...m, default: sheet(), sheet: other } }, ...place(m)))), false)
  assert.equal(auto(compileBoard(h(PCB, { name: 'D', schematic: { ...m, sheet: sheet() } }, ...place(m)))), false)
  assert.equal(auto(compileBoard(h(PCB, { name: 'E', schematic: sheet() }, ...place(m)))), false, 'a drawing instance as before')
})

test('schematic namespace: parts and nets carry their export, and findings name a part by it where it differs from the ref', () => {
  const m = module()
  const b = compileBoard(h(PCB, { name: 'N', schematic: m }, ...place(m)))
  const part = r => b.schematic.parts.find(p => p.ref === r)
  assert.equal(part('R1').export.name, 'R1')
  assert.equal(part('R2').export.name, 'Rpull')
  assert.equal(part('R2').export.module, fileURLToPath(import.meta.url))
  assert.equal(b.schematic.nets.find(n => n.name === 'VCC').export.name, 'VCC')
  const ix = new BoardIndex(b)
  assert.equal(refsText(['R1', 'R2'].map(r => ix.refOf(r))), 'R1, R2 (Rpull)')
  const plain = compileBoard(h(PCB, { name: 'P' }, ...place(module())))
  assert.equal(plain.schematic.parts.find(p => p.ref === 'R2').export, undefined, 'parts imported by name have no export')
})

const SCH = `import { nets } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'
export const { VCC, GND } = nets()
export const R1 = R0603('330').connect(VCC, GND)
export const Rpull = R0603('10k').connect(VCC, GND)
export const D1 = LED0603('red').connect({ A: VCC, K: GND })
`
const TSCONFIG = { compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', jsxImportSource: '@pcbjs/core', strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ['*.ts', '*.tsx'] }

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-scope-'))
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'))
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG))
  writeFileSync(join(dir, 'pcb.config.ts'), `import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n`)
  writeFileSync(join(dir, 'board.sch.ts'), SCH)
  for (const [f, code] of Object.entries(files)) writeFileSync(join(dir, f), code)
  return dir
}
const run = (dir, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' })

test('schematic scope: a bare-form board compiles through the CLI, and findings and inspect use the export name', () => {
  const dir = project({ 'pcb.tsx': `import PCB from '@pcbjs/core'
import * as sch from './board.sch'
export default <PCB name="Scope" schematic={sch}>
  <rect layer="Edge.Cuts" x={0} y={0} w={20} h={10} />
  <R1 at="5 5" />
  <Rpull at="10 5" />
  <sch.D1 at="15 5" />
</PCB>
` })
  try {
    const c = run(dir, 'check')
    assert.doesNotMatch(c.stdout + c.stderr, /compile error/)
    assert.match(c.stdout, /Scope {2}pcb\.tsx {2}3 footprints/)
    assert.match(c.stdout, /R1, R2 \(Rpull\) {2}pcb\.tsx:5:3/)
    assert.match(c.stdout, /typecheck {2}ok/)
    const i = run(dir, 'inspect', 'Rpull')
    assert.match(i.stdout, /^R2 \(Rpull\) {2}10k/m)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('schematic scope: the type check binds the bare names and maps positions back, a free name that is no export stays an error', () => {
  const dir = project({ 'pcb.tsx': `import PCB from '@pcbjs/core'
import * as sch from './board.sch'; const bad: number = 'x'
export default <PCB name="Scope" schematic={sch}>
  <Rpull at="10 5" wrong />
  <R9 at="1 1" />
</PCB>
` })
  try {
    const c = run(dir, 'check')
    const lines = c.stdout.split('\n').filter(l => l.startsWith('error    typecheck'))
    assert.deepEqual(lines.map(l => / pcb\.tsx:(\d+:\d+): (TS\d+)/.exec(l).slice(1).join(' ')), ['2:43 TS2322', '4:20 TS2322', '5:4 TS2304'])
    assert.match(lines[2], /Cannot find name 'R9'/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('schematic scope: <sch.U1 /> with a member tag type-checks with typed pads, and the JSX factory gets the part itself', async () => {
  const code = `import PCB, { route } from '@pcbjs/core'
import * as sch from './board.sch'
export const tag = <sch.R1 at="1 2" />
export const pad = sch.D1.A
export default <PCB name="M" schematic={sch}>{tag}</PCB>
`
  const dir = project({ 'pcb.tsx': code, 'bad.tsx': `import * as sch from './board.sch'\nexport const x = <sch.R1 at="1 2" side="X" />\nexport const y = sch.D1.Q\n` })
  try {
    const opts = ts.convertCompilerOptionsFromJson(TSCONFIG.compilerOptions, dir).options
    const { host, injections } = scopeHost(opts, dir)
    const program = ts.createProgram([join(dir, 'pcb.tsx'), join(dir, 'bad.tsx')], opts, host)
    const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file && !d.file.fileName.includes('node_modules'))
    const where = diags.map(d => `${d.file.fileName.endsWith('bad.tsx') ? 'bad' : 'pcb'}:${sourcePosition(d, injections).line} TS${d.code}`)
    assert.deepEqual(where.sort(), ['bad:2 TS2322', 'bad:3 TS2339'])
    writeFileSync(join(dir, 'tag.mjs'), ts.transpileModule(code, { compilerOptions: { ...opts, module: ts.ModuleKind.ESNext }, fileName: 'pcb.tsx' }).outputText.replace("'./board.sch'", "'./board.sch.mjs'"))
    writeFileSync(join(dir, 'board.sch.mjs'), ts.transpileModule(SCH, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText)
    const mod = await import(pathToFileURL(join(dir, 'tag.mjs')).href)
    const sch = await import(pathToFileURL(join(dir, 'board.sch.mjs')).href)
    assert.equal(mod.tag.type, sch.R1)
    assert.equal(mod.pad.net.name, 'VCC')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

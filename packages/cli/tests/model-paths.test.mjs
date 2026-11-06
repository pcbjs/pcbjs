// Model paths and `model add --write` on a project with its own footprints: a path is relative to the file that holds the
// `model` literal, as an import is, whether that is a part call, a <footprint> in lib/ or a footprint shared from outside the
// project; --footprint writes on the <footprint> element, never on a placement; --ref writes the options form; and an LCSC
// part's model comes from EasyEDA's library.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const KICAD = join(REPO, 'examples', 'highspeed', 'models')

// a two-pad 0603 land pattern in lib/, used by two parts, and one in ../shared outside the project with a model beside it
const FP = (id, model) => `import { defineFootprint, type FootprintProps } from '@pcbjs/core'
export function Chip(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="${id}" value="R" height={0.6}${model ? ` model={{ file: '${model}' }}` : ''} {...rest}>
      <pad num={1} at="-0.825 0" size={[0.8, 0.95]} />
      <pad num={2} at="0.825 0" size={[0.8, 0.95]} />
      <rect layer="F.CrtYd" x={-1.48} y={-0.73} w={2.96} h={1.46} width={0.05} />
      {children}
    </footprint>
  )
}
export const CHIP = defineFootprint(Chip, { pins: ['1', '2'], prefix: 'R' })
`
const PCB = `import PCB from '@pcbjs/core'
import { CHIP } from './lib/parts'
import { SHARED } from '../shared/parts'

const R1 = CHIP('10k').source({ MPN: 'RC0603', 'MPN:LCSC': 'C22775' })
const R2 = CHIP('1k')
const R3 = SHARED('2k')
const R4 = CHIP('4k7', { model: { file: './models/R.step' } })
const R5 = CHIP('5k', { model: { file: './models/R.step' } })

export default (
  <PCB name="Paths">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <R1 at="5 5" /><R2 at="10 5" /><g at="15 5"><R3 /></g><R4 at="20 5" /><R5 at="25 5" />
  </PCB>
)
`

const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-paths-')))
const root = join(top, 'board'),
  shared = join(top, 'shared')
for (const d of [root, join(root, 'lib'), join(root, 'models'), join(root, 'node_modules'), shared, join(shared, 'models'), join(top, 'node_modules')])
  mkdirSync(d, { recursive: true })
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(top, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
writeFileSync(join(root, 'pcb.tsx'), PCB)
writeFileSync(join(root, 'lib', 'parts.tsx'), FP('t:CHIP'))
writeFileSync(join(shared, 'parts.tsx'), FP('t:SHARED', './models/R.step').replace(/CHIP/g, 'SHARED'))
copyFileSync(join(KICAD, 'R_0603_1608Metric.step'), join(root, 'models', 'R.step'))
copyFileSync(join(KICAD, 'R_0603_1608Metric.step'), join(shared, 'models', 'R.step'))
copyFileSync(join(KICAD, 'R_0603_1608Metric.step'), join(top, 'R.step'))
after(() => rmSync(top, { recursive: true, force: true }))

const run = (...args) => {
  const r = spawnSync(process.execPath, [BIN, 'model', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { code: r.status, out: r.stdout.replaceAll('\\', '/'), err: r.stderr }
}

test('a model path is relative to the file that holds the literal: a part call, or a footprint shared from outside the project', () => {
  const r = run('check')
  assert.equal(r.code, 0, r.out + r.err)
  assert.match(r.out, /R3\s+file \S*shared\/models\/R\.step\s+ok/)
  assert.match(r.out, /R4\s+file models\/R\.step\s+ok/)
  // the option of the part call, in pcb.tsx, though the footprint is in lib/
  assert.match(r.out, /R5\s+file models\/R\.step\s+ok/)
})

test('--ref writes the model into the options after the value, the path relative to that file', () => {
  const r = run('add', 'models/R.step', '--ref', 'R1', '--write')
  assert.equal(r.code, 0, r.out + r.err)
  assert.match(
    readFileSync(join(root, 'pcb.tsx'), 'utf8'),
    /const R1 = CHIP\('10k', \{ model: \{ file: '\.\/models\/R\.step' \} \}\)\.source\(\{ MPN: 'RC0603', 'MPN:LCSC': 'C22775' \}\)/,
  )
  assert.match(r.out, /fit  the file's own frame/)
  // the board compiles with it and the shared footprint's other part is named for --footprint
  assert.match(r.out, /note  R2 uses the same footprint: pcbjs model add models\/R\.step --footprint t:CHIP --write/)
  assert.match(run('check').out, /R1\s+file models\/R\.step\s+ok/)
})

test('--footprint writes on the <footprint> element in lib/, relative to that file, not on a placement', () => {
  const r = run('add', '../R.step', '--footprint', 't:CHIP', '--write')
  assert.equal(r.code, 0, r.out + r.err)
  assert.match(r.out, /model: \{ file: '\.\.\/models\/R\.step' \}/)
  assert.match(r.out, /wrote lib\/parts\.tsx:5/)
  assert.match(readFileSync(join(root, 'lib', 'parts.tsx'), 'utf8'), /<footprint model=\{\{ file: '\.\.\/models\/R\.step' \}\} id="t:CHIP"/)
  const c = run('check')
  assert.match(c.out, /R1\s+file models\/R\.step\s+ok/)
  assert.match(c.out, /R2\s+file models\/R\.step\s+ok/)
  // a footprint outside the project, placed in a group: found by its id, the group left alone
  const s = run('add', '../R.step', '--footprint', 't:SHARED', '--write')
  assert.equal(s.code, 0, s.out + s.err)
  assert.match(s.out, /wrote \.\.\/shared\/parts\.tsx:5/)
  assert.match(readFileSync(join(shared, 'parts.tsx'), 'utf8'), /model=\{\{ file: '\.\.\/board\/models\/R\.step' \}\}/)
  assert.doesNotMatch(readFileSync(join(root, 'pcb.tsx'), 'utf8'), /<g model/)
  assert.match(run('check').out, /R3\s+file models\/R\.step\s+ok/)
})

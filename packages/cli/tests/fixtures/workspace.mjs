// A workspace of two folders for the workspace dev server tests: f1/alpha and f2 each a project whose pcb.config.ts sets
// a different default board, plus a pcb.config.ts inside node_modules that must never count as a scope.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

const board = (name, extra = '') => `import PCB from '@pcbjs/core'
${extra}
export default (
  <PCB name="${name}">
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />
    <footprint ref="TP1" value="V" id="pcbjs:TestPad-2mm" at="5mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
    <footprint ref="TP2" value="V" id="pcbjs:TestPad-2mm" at="15mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
    <track net="V" layer="F.Cu" width={0.5} d="M 5 10 H 15" />
  </PCB>
)
`
const config = (revision, clearance) => `import { defineConfig, defineDefaultBoard } from '@pcbjs/core'
defineDefaultBoard({ revision: '${revision}', rules: { clearance: ${clearance} } })
export default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })
`

export { board }

/** Write the workspace into a new temporary directory and return its paths. */
export function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-ws-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  const f1 = join(root, 'f1'), f2 = join(root, 'f2'), alpha = join(f1, 'alpha')
  for (const d of [alpha, f2, join(f1, 'node_modules', 'dep'), join(f1, '.hidden')]) mkdirSync(d, { recursive: true })
  writeFileSync(join(alpha, 'pcb.config.ts'), config('A-1', 0.3))
  writeFileSync(join(alpha, 'pcb.tsx'), board('Alpha'))
  writeFileSync(join(f2, 'pcb.config.ts'), config('B-2', 0.15))
  writeFileSync(join(f2, 'pcb.tsx'), board('Beta'))
  writeFileSync(join(f1, 'node_modules', 'dep', 'pcb.config.ts'), 'export default {}\n')
  writeFileSync(join(f1, '.hidden', 'pcb.config.ts'), 'export default {}\n')
  return { root, f1, f2, alpha }
}

/**
 * The layout of examples/motor-stack: two projects, a/ and b/, beside a lib/ that is no scope and that both import, plus a
 * lib file neither imports.
 */
export function makeStack() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-stack-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  const stack = join(root, 'stack'), lib = join(stack, 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'shared.ts'), shared('T1'))
  writeFileSync(join(lib, 'unused.ts'), "export const UNUSED = 1\n")
  for (const name of ['a', 'b']) {
    mkdirSync(join(stack, name))
    writeFileSync(join(stack, name, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
    writeFileSync(join(stack, name, 'pcb.tsx'), stackBoard(name.toUpperCase()))
  }
  return { root, stack, lib, a: join(stack, 'a'), b: join(stack, 'b') }
}
export const shared = title => `export const TITLE = '${title}'\n`
export const stackBoard = (name, rev = '1') => board(name, "import { TITLE } from '../lib/shared'").replace(`<PCB name="${name}">`, `<PCB name="${name}" title={TITLE} revision="${rev}">`)

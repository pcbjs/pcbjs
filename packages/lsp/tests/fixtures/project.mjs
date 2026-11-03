// A one-board project for the language server tests, written into a new temporary directory whose node_modules links the
// repository's @pcbjs packages. The board has two test pad parts, two routes between their pads with chains and drawn copper
// too thin for the rules, so it has a DRC finding with a source.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

export const BOARD = `import PCB, { defineFootprint, nets, route, type FootprintProps } from '@pcbjs/core'

const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint value="V" id="pcbjs:TestPad" bom={false} {...props}><pad num={1} size={2} shape="circle" /></footprint>
}, { pins: ['1'], prefix: 'TP' })
const { V } = nets()
const TP1 = TestPad().connect({ 1: V })
const TP2 = TestPad().connect({ 1: V })

export default (
  <PCB name="Fix" rules={{ minTrackWidth: 0.2 }}>
    <path layer="Edge.Cuts" d="M 0 0 H 30 V 20 H 0 Z" />
    <TP1 at="5 10" />
    <TP2 at="25 10" />
    {route(TP1[1], TP2[1]).H(15).V(14).H(25).Z()}
    {route(TP1[1], TP2[1]).V(17).H(25).Z()}
    {route('5 3').net(V).width(0.1).H(10)}
  </PCB>
)
`

export const CONFIG = `import { defineConfig } from '@pcbjs/core'
export default defineConfig({ entries: ['main.tsx'], vite: { logLevel: 'silent' } })
`

export function makeProject(board = BOARD) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-lsp-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), CONFIG)
  writeFileSync(join(root, 'main.tsx'), board)
  return { root, main: join(root, 'main.tsx') }
}

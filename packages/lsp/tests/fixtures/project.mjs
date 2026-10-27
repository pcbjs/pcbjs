// A one-board project for the language server tests, written into a new temporary directory whose node_modules links the
// repository's @pcbjs packages. The board has a route between two pads with a path string, the same in the chain form, two placements and a track
// too thin for the rules, so it has a DRC finding with a source.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

export const BOARD = `import PCB, { route } from '@pcbjs/core'

export default (
  <PCB name="Fix" rules={{ minTrackWidth: 0.2 }}>
    <path layer="Edge.Cuts" d="M 0 0 H 30 V 20 H 0 Z" />
    <footprint ref="TP1" value="V" id="pcbjs:TestPad" at="5 10" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
    <footprint ref="TP2" value="V" id="pcbjs:TestPad" at="25 10" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
    {route('TP1.1', 'TP2.1', 'H 15 V 14 H 25 Z')}
    {route('TP1.1').V(17).H(25).Z('TP2.1')}
    <track net="V" layer="F.Cu" width={0.1} d="M 5 3 H 10" />
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

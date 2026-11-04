// The boards of the interaction matrix, compiled as the session compiles them, through the CLI from a scratch copy of the demo:
// Blinky, Fx, a scratch board with an instance, a bound route with an automatic leg, a pour, a text and an unconnected net, and Nx,
// two pairs of laid-out channels nested in a laid-out pair beside two circuits named alike in two files.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const FX = `import PCB, { nets, circuit, layout, route, pour } from '@pcbjs/core'
import { R0603, LED0603, PinHeader } from '@pcbjs/lib'

const chan = circuit('chan', ({ VCC, SW }, { nets: { led } }) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: led })
  const D01 = LED0603('green').connect({ A: led, K: SW })
  const vccTrunk = route('2 0').net(VCC).width(0.3).H(4.175)
  return { R01, D01, vccTrunk }
})
const Row = layout(
  chan,
  (g, { at }) => (
    <g at={at}>
      <g.R01 at="5 0" />
      <g.D01 at="10 0 180deg" />
      {g.vccTrunk}
    </g>
  ),
  'Row',
)

export const { GND, VCC, SW, U } = nets()
const CH2 = chan({ VCC, SW }, 'CH2')
const J1 = PinHeader(3)().connect({ 1: GND, 2: VCC, 3: SW })
const R5 = R0603('1k').connect({ 1: U, 2: GND })
const R6 = R0603('1k').connect({ 1: U, 2: GND })
const trunk = route('3 12.54').net(VCC).width(0.3).H(8).X('14 8').H(20)

export default (
  <PCB name="Fx">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <J1 at="3 10" />
    <Row g={CH2} at="0 4" />
    <R5 at="20 16" />
    <R6 at="26 16" />
    {trunk}
    {pour(GND, 'B.Cu', 'M 0 0 H 30 V 20 H 0 Z')}
    <text layer="F.SilkS" at="15 18.5" size={1}>
      Fx
    </text>
  </PCB>
)
`

const TWIN = (v, name) => `import { circuit } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'

export const ${name} = circuit('cell', ({ A, B }) => ({ R01: R0603('${v}').connect({ 1: A, 2: B }) }))
`

const NX = `import PCB, { nets, circuit, layout } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'
import { cellA } from './lib/twin-a'
import { cellB } from './lib/twin-b'

const chan = circuit('chan', ({ VCC, SW }, { nets: { led } }) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: led })
  const D01 = LED0603('green').connect({ A: led, K: SW })
  return { R01, D01 }
})
const pair = circuit('pair', ({ VCC, SW }) => ({ A1: chan({ VCC, SW }, 'A1'), B2: chan({ VCC, SW }, 'B2') }))
const Row = layout(chan, (g, { at }) => <g at={at}><g.R01 at="2 0" /><g.D01 at="6 0" /></g>, 'Row')
const Pair = layout(pair, (g, { at }) => <g at={at}><Row g={g.A1} at="0 0" /><Row g={g.B2} at="0 4" /></g>, 'Pair')

export const { VCC, SW, A, B } = nets()
const P1 = pair({ VCC, SW }, 'P1')
const P2 = pair({ VCC, SW }, 'P2')
const TA1 = cellA({ A, B }, 'TA1')
const TB2 = cellB({ A, B }, 'TB2')

export default (
  <PCB name="Nx">
    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={30} />
    <Pair g={P1} at="5 5" />
    <Pair g={P2} at="20 5 90" />
    <TA1.R01 at="5 22" />
    <TB2.R01 at="15 22" />
  </PCB>
)
`

/** Blinky, Fx and Nx by name, each its board model and site data, with the copy's root and the text of a file in it; `done` removes the copy. */
export async function boards() {
  const { resolveConfig } = await import('@pcbjs/cli/internal/config')
  const { pluginState } = await import('@pcbjs/cli/internal/site')
  const { compileServer } = await import('@pcbjs/cli/internal/compile')
  const { viteLoader } = await import('@pcbjs/cli/internal/loader')
  const { compileEntry } = await import('@pcbjs/cli/internal/project')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-ix-')))
  cpSync(join(REPO, 'examples', 'demo'), root, { recursive: true, filter: s => !/\/(node_modules|\.pcbjs)(\/|$)/.test(s.slice(REPO.length)) })
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'fx.pcb.tsx'), FX)
  writeFileSync(join(root, 'nx.pcb.tsx'), NX)
  writeFileSync(join(root, 'lib', 'twin-a.ts'), TWIN('1k', 'cellA'))
  writeFileSync(join(root, 'lib', 'twin-b.ts'), TWIN('2k', 'cellB'))
  const cfgFile = join(root, 'pcb.config.ts')
  writeFileSync(cfgFile, readFileSync(cfgFile, 'utf8').replace(/entries:\s*\[[^\]]*\]/, "entries: ['blinky.pcb.tsx', 'fx.pcb.tsx', 'nx.pcb.tsx']"))
  const cfg = await resolveConfig([], 'build', undefined, root, () => {})
  const state = pluginState(cfg)
  const server = await compileServer(cfg)
  const out = { root, text: file => readFileSync(resolve(root, file), 'utf8'), done: () => rmSync(root, { recursive: true, force: true }) }
  try {
    for (const slot of state.slots) {
      const [c] = await compileEntry(viteLoader(server), cfg, slot.entry, { dev: true })
      out[c.board.name] = { board: c.board, site: c.site }
    }
  } finally {
    await server.close()
  }
  return out
}

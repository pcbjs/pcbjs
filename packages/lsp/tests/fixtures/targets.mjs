// A project for the target tests: parts, nets, a group and a circuit instance in a schematic module, a board that imports
// them by name with a route, a via, a pour, a reference and a symbol placed by its part element, and a second board that uses its schematic as a namespace.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

export const FILES = {
  'pcb.config.ts': `import { defineConfig } from '@pcbjs/core'
export default defineConfig({ entries: ['main.tsx', 'ns.tsx'], vite: { logLevel: 'silent' } })
`,
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', jsxImportSource: '@pcbjs/core', strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ['*.ts', '*.tsx'] }),
  'board.sch.ts': `import { nets, group, circuit, type Ports } from '@pcbjs/core'
import { R0603, C0603, LED0603, PinHeader } from '@pcbjs/lib'

export const { GND, VCC, SIG } = nets()
export const J1 = PinHeader(2).connect(GND, VCC)
export const D1 = LED0603('red').connect({ A: SIG, K: GND })
export const P1 = group('P1', { R3: R0603('1k').connect(VCC, SIG) })
export const chan = circuit('chan', ({ VCC, GND }: Ports<'VCC' | 'GND'>, { nets: { mid } }) => ({
  R: R0603('330').connect(VCC, mid),
  C: C0603('1u').connect(mid, GND),
}))
export const CH1 = chan({ VCC, GND }, 'CH1')
`,
  'main.tsx': `import PCB, { route, via, pour, reference, Schematic } from '@pcbjs/core'
import { J1, D1, P1, CH1, GND, SIG } from './board.sch'

export default (
  <PCB name="Targets" copper={2} schematic={sheet()}>
    <path layer="Edge.Cuts" d="M 0 0 H 40 V 30 H 0 Z" />
    <J1 at="5 15" />
    <D1 at="20 10" />
    <P1.R3 at="20 20" />
    <CH1.R at="30 10" />
    <CH1.C at="30 20" />
    {route(D1.K, '24.375 17.6 B.Cu')}
    {route(D1[2]).X(P1.R3.pad(2))}
    {via(SIG, '12 25')}
    {pour(GND, 'B.Cu', 'M 0 0 H 40 V 30 H 0 Z')}
    {reference('./other.tsx', { at: [0, 0, 10] })}
  </PCB>
)

function sheet() {
  return (
    <Schematic>
      <D1 at="4 6" flip />
    </Schematic>
  )
}
`,
  'other.tsx': `import PCB from '@pcbjs/core'
export default (
  <PCB name="Other">
    <path layer="Edge.Cuts" d="M 2 2 H 12 V 12 H 2 Z" />
  </PCB>
)
`,
  'ns.sch.ts': `import { nets } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

export const { A1, K1 } = nets()
export const D2 = LED0603('green').connect({ A: A1, K: K1 })
export const R2 = R0603('1k').connect(A1, K1)
`,
  'ns.tsx': `import PCB, { route } from '@pcbjs/core'
import * as sch from './ns.sch'

export default (
  <PCB name="Ns">
    <path layer="Edge.Cuts" d="M 0 0 H 20 V 20 H 0 Z" />
    <sch.D2 at="5 10" />
    <sch.R2 at="15 10" />
    {route(sch.D2.A).X(sch.R2[1])}
  </PCB>
)
`,
  // not an entry: the bare names the compiler brings into scope from a schematic namespace
  'bare.tsx': `import PCB from '@pcbjs/core'
import * as sch from './ns.sch'

export default (
  <PCB name="Bare" schematic={sch}>
    <D2 at="5 10" />
    {D2.A}
  </PCB>
)
`,
}

export function makeTargets() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-targets-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  for (const [name, text] of Object.entries(FILES)) writeFileSync(join(root, name), text)
  return root
}

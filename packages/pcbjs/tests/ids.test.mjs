// Item uids and finding identity through the CLI: a uid names who made the item, so it stays under a line inserted above, a part inserted
// elsewhere, an edited call and a moved part; fingerprints stay across unrelated edits, and every stored message is its rule's template.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { messageOf, TEMPLATE_RULES } from '@pcbjs/compile/internal/messages'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(PKG, 'bin', 'pcbjs.js')

const cli = (cwd, ...args) =>
  new Promise(done => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NODE_ENV: 'production' }, timeout: 120000 }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    })
  })

const TESTPAD = `import { defineFootprint, type FootprintProps } from '@pcbjs/core'
export const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint id="pcbjs:TestPad-2mm" bom={false} {...props}><pad num={1} size={2} shape="circle" /></footprint>
}, { pins: ['1'], prefix: 'TP' })
`
const PADS = `import { nets } from '@pcbjs/core'
import { TestPad } from './testpad'
export const { V, W } = nets()
export const TP1 = TestPad('V').connect({ 1: V })
export const TP2 = TestPad('V').connect({ 1: V })
export const TP3 = TestPad('W').connect({ 1: W })
`
const MORE = `import { W } from './pads'
import { TestPad } from './testpad'
export const TP4 = TestPad('W').connect({ 1: W })
`
// TP3 sits on the V track: a short, and a single pad of W until TP4 is placed
const board = ({
  above = '',
  extra = '',
  h = 'H(15)',
} = {}) => `import PCB, { route } from '@pcbjs/core'; import { V, TP1, TP2, TP3 } from './pads'${extra ? "; import { TP4 } from './more'" : ''}
${above}export default (
  <PCB name="Ids" rev="1.0" rules={{ clearance: 0.2, minTrackWidth: 0.2 }}>
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />
    <TP1 at="5mm 10mm" />
    <TP2 at="15mm 10mm" />
    {route('5 10').net(V).width(0.5).${h}}
    <TP3 at="10mm 10.5mm" />
    ${extra}
  </PCB>
)
`
let root
before(() => {
  root = mkdtempSync(join(tmpdir(), 'pcbjs-ids-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(PKG, '..', '..', 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'testpad.tsx'), TESTPAD)
  writeFileSync(join(root, 'pads.tsx'), PADS)
  writeFileSync(join(root, 'more.tsx'), MORE)
})
after(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

/** The uids of net V's track and pads, and the check report's findings, of the board the options give. */
async function compiled(o) {
  writeFileSync(join(root, 'ids.tsx'), board(o))
  const v = await cli(root, 'inspect', 'ids.tsx', 'net:V', '--json')
  assert.equal(v.code, 0, v.stdout + v.stderr)
  const j = JSON.parse(v.stdout)
  await cli(root, 'check', 'ids.tsx', '--json', 'report.json')
  const report = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'))
  const findings = report.boards[0].findings
  return { track: j.tracks[0].ref, pads: j.pads.map(p => p.uid), findings, ids: findings.map(f => [f.id, f.fingerprint, f.items, f.refs]) }
}

const prints = fs => fs.map(f => `${f.rule} ${f.fingerprint}`).sort()

test('uids: kept under a line inserted above, a part placed elsewhere, a call edited and a part moved; fingerprints kept by every unrelated edit', async () => {
  const base = await compiled()
  assert.match(base.track, /^item:[0-9a-f]{12}$/)
  assert.equal(new Set([base.track, ...base.pads]).size, 3)
  const above = await compiled({ above: '// a line above the board\n' })
  assert.deepEqual([above.track, above.pads, above.ids], [base.track, base.pads, base.ids], 'a line above moves every range, and changes no uid, id or fingerprint')
  const placed = await compiled({ extra: '<TP4 at="10mm 4mm" />' })
  assert.equal(placed.track, base.track)
  assert.deepEqual(placed.pads, base.pads)
  // the findings of net V, which the new part leaves alone
  const ofV = fs => prints(fs.filter(f => f.refs.includes('net:V')))
  assert.deepEqual(ofV(placed.findings), ofV(base.findings))
  const short = f => f.findings.find(x => x.rule === 'short')
  assert.equal(short(placed).id, short(base).id)
  // the same track written H( 15 ): route:1 still made it, so its uid stays and the short keeps its exact id
  const edited = await compiled({ h: 'H( 15 )' })
  assert.equal(edited.track, base.track)
  assert.deepEqual(edited.pads, base.pads)
  assert.equal(short(edited).id, short(base).id)
  // TP4 moved and turned: its part made its pad, so the pad keeps its uid
  const pad = async at => {
    writeFileSync(join(root, 'ids.tsx'), board({ extra: `<TP4 at="${at}" />` }))
    const r = await cli(root, 'inspect', 'ids.tsx', 'TP4/1', '--json')
    assert.equal(r.code, 0, r.stdout + r.stderr)
    return JSON.parse(r.stdout).pad.uid
  }
  assert.equal(await pad('14mm 4mm 90'), await pad('10mm 4mm'))
})

test('messages: every finding of the report is its rule template over its fields', async () => {
  const { findings } = await compiled({ extra: '<TP4 at="19.5mm 10mm" />' })
  assert.deepEqual(findings.map(f => f.rule).sort(), ['edge-clearance', 'short', 'unconnected'])
  for (const f of findings) {
    assert.ok(TEMPLATE_RULES.includes(f.rule), `${f.rule} has a template`)
    assert.equal(f.message, messageOf(f), f.rule)
  }
})

test('inspect: a pad, a net, a route point, an item and a finding by the references check prints', async () => {
  const { findings, track } = await compiled()
  const short = findings.find(f => f.rule === 'short')
  const ask = async q => {
    const r = await cli(root, 'inspect', 'ids.tsx', q, '--json')
    assert.equal(r.code, 0, `${q}: ${r.stdout}${r.stderr}`)
    return JSON.parse(r.stdout)
  }
  assert.deepEqual((await ask('TP1/1')).pad.net, 'V')
  assert.equal((await ask('net:V')).net.ref, 'net:V')
  assert.deepEqual((await ask('route:1/pt:1')).pt.at, [15, 10])
  assert.deepEqual(
    (await ask('route:1')).route.points.map(p => p.at),
    [
      [5, 10],
      [15, 10],
    ],
  )
  assert.equal((await ask(track)).item.ref, track)
  const f = await ask(short.id)
  assert.deepEqual([f.finding.id, f.finding.fingerprint], [short.id, short.fingerprint])
  const missing = await cli(root, 'inspect', 'ids.tsx', 'route:1/pt:5')
  assert.equal(missing.code, 1)
  assert.match(missing.stdout, /route:1 has points pt:0 to pt:1/)
})

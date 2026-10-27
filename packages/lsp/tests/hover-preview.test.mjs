// The hover previews through a real dev server: on examples/demo blinky.pcb.tsx, examples/usb3-hub and a small keepout board,
// each hover kind starts with an SVG image whose crop holds the item, and on usb3-hub the renders stay under 50 ms.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dev } from '@pcbjs/cli/server'
import { renderPreview } from '../dist/preview.js'
import { makeProject } from './fixtures/project.mjs'
import { initParams, posOf, viteClient } from './fixtures/client.mjs'

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples')
const PORT = 5351

/** One dev server with a language client, its boards' data fetched once. */
async function session(root, boards) {
  const server = await dev({ root, port: PORT, host: '127.0.0.1' })
  server.config.logger.info = () => {}
  const sites = {}
  for (const b of boards) sites[b] = await (await fetch(`http://127.0.0.1:${PORT}/__pcbjs/board.json${b ? `?board=${b}` : ''}`)).json()
  const client = await viteClient(PORT)
  await client.conn.sendRequest('initialize', initParams(root))
  await client.conn.sendNotification('initialized', {})
  const open = async file => {
    const text = readFileSync(file, 'utf8'), uri = pathToFileURL(file).href
    await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
    return { text, uri }
  }
  const hover = async (d, needle, delta = 0, n = 0) => {
    const t0 = performance.now()
    const h = await client.conn.sendRequest('textDocument/hover', { textDocument: { uri: d.uri }, position: posOf(d.text, needle, delta, n) })
    return { value: h?.contents.value ?? '', ms: performance.now() - t0 }
  }
  return { server, client, sites, open, hover, close: async () => { client.close(); await server.close() } }
}

/** The image at the start of a hover: its SVG and its crop in mm. */
function image(value) {
  const m = /^!\[([^\]]*)\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)\n\n/.exec(value)
  assert.ok(m, `no image first: ${value.slice(0, 160)}`)
  const svg = Buffer.from(m[2], 'base64').toString()
  assert.match(svg, /^<svg xmlns='http:\/\/www.w3.org\/2000\/svg' width='360' height='\d+'/)
  assert.doesNotMatch(svg, /<text/, 'text is stroked, never an SVG font')
  const [x, y, w, h] = /data-box='([^']+)'/.exec(svg)[1].split(' ').map(Number)
  assert.ok(value.length < 100000, `the hover is ${value.length} characters, VS Code cuts at 100 000`)
  return { alt: m[1], svg, box: { x, y, w, h }, rest: value.slice(m[0].length) }
}

const contains = (box, b) => b.x0 >= box.x - 1e-6 && b.y0 >= box.y - 1e-6 && b.x1 <= box.x + box.w + 1e-6 && b.y1 <= box.y + box.h + 1e-6
const boxOf = pts => pts.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
const itemsBox = (site, pred) => boxOf(site.items.filter(pred).flatMap(i => i.rings.flat()))
/** The ids of the innermost source range at a needle, as the server finds it. */
function rangeIds(site, rel, d, needle, delta = 0, n = 0) {
  const p = posOf(d.text, needle, delta, n), line = p.line + 1, col = p.character + 1
  const at = (site.sources[rel] ?? []).filter(r => (r.start[0] < line || (r.start[0] === line && r.start[1] <= col)) && (r.end[0] > line || (r.end[0] === line && r.end[1] >= col - 1)))
  at.sort((a, b) => (a.end[0] - a.start[0]) * 1e6 + a.end[1] - a.start[1] - ((b.end[0] - b.start[0]) * 1e6 + b.end[1] - b.start[1]))
  return new Set(at[0].ids)
}
/** A footprint's pads in its own frame. */
const localPads = fp => fp.pads.map(p => {
  const r = fp.rot * Math.PI / 180, dx = p.at[0] - fp.at[0], dy = p.at[1] - fp.at[1]
  const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r)
  return [fp.side === 'B' ? -lx : lx, ly]
})

let demo
before(async () => {
  demo = await session(join(EXAMPLES, 'demo'), ['blinky'])
})
after(async () => { await demo?.close() })

test('blinky: a placement shows its courtyard in the crop, with ref, value, footprint and position', async () => {
  const s = demo.sites.blinky, d = await demo.open(join(EXAMPLES, 'demo', 'blinky.pcb.tsx'))
  // on `at`, outside the tag name, which is the part itself and shows its land pattern
  const img = image((await demo.hover(d, '<Q1 at', 5)).value)
  assert.match(image((await demo.hover(d, '<Q1 at', 2)).value).alt, /^footprint on Blinky$/)
  const fp = s.footprints.find(f => f.ref === 'Q1')
  assert.ok(contains(img.box, { x0: fp.bbox.x, y0: fp.bbox.y, x1: fp.bbox.x + fp.bbox.w, y1: fp.bbox.y + fp.bbox.h }), JSON.stringify([img.box, fp.bbox]))
  assert.match(img.alt, /^placement on Blinky$/)
  assert.match(img.rest, /^\*\*Q1\*\* MMBT3904 · pcbjs:SOT-23 · at 26, 10 mm · front\n/)
  assert.match(img.svg, /stroke-dasharray/, 'the selection is dashed as the viewer draws it')
})

test('blinky: a route path, a chain command, a pour, a via and a text crop around what they drew', async () => {
  const s = demo.sites.blinky, d = await demo.open(join(EXAMPLES, 'demo', 'blinky.pcb.tsx'))
  for (const [needle, delta, n] of [["'M 3 10 H 9", 4, 0], ['.V(14)', 2, 0], ['pour(GND', 1, 0], ["via(VCC, '15.8", 1, 0], ['<text layer="F.SilkS" at="3 4.3"', 2, 0]]) {
    const ids = rangeIds(s, 'blinky.pcb.tsx', d, needle, delta, n)
    assert.ok(ids.size, needle)
    const { value } = await demo.hover(d, needle, delta, n)
    const img = image(value)
    assert.ok(contains(img.box, itemsBox(s, i => ids.has(i.id))), `${needle}: ${JSON.stringify(img.box)}`)
    assert.match(img.svg, new RegExp(`stroke='#6ea8ff'`), `${needle}: outlined in the accent`)
  }
  // the text below the image is the hover as it was
  const { value } = await demo.hover(d, '.V(14)', 2)
  assert.match(image(value).rest, /\*\*pcbjs chainCommand\*\*/)
})

test('blinky: a pad reference shows the pad, a net name the whole net with its pads named', async () => {
  const s = demo.sites.blinky, d = await demo.open(join(EXAMPLES, 'demo', 'blinky.pcb.tsx'))
  // the pad outlined on its part's land pattern, in the footprint's own frame
  const pad = image((await demo.hover(d, 'route(J1[3]', 9)).value)
  assert.match(pad.alt, /^pad on Blinky$/)
  assert.ok(pad.box.x < 0 && pad.box.x + pad.box.w > 0 && pad.box.y < 0 && pad.box.y + pad.box.h > 0, JSON.stringify(pad.box))
  assert.match(pad.rest, /^pad \*\*J1\.3\*\* \S* ?· net SIG · at /)
  const net = image((await demo.hover(d, 'pour(GND', 6)).value)
  assert.ok(contains(net.box, itemsBox(s, i => i.net === 'GND' && i.kind !== 'zone')))
  assert.match(net.alt, /^net on Blinky$/)
  assert.match(net.rest, /^net \*\*GND\*\* · 3 pads · \d+ tracks? · \d+ vias? · 1 pour\n\nJ1\.1, Q1\.2, C1\.2\n\n/)
})

test('blinky: a footprint factory call shows the land pattern in its own frame with pad numbers', async () => {
  const s = demo.sites.blinky, d = await demo.open(join(EXAMPLES, 'demo', 'blinky.sch.tsx'))
  const img = image((await demo.hover(d, "C0603('100n')", 2)).value)
  const fp = s.footprints.find(f => f.ref === 'C1')
  assert.ok(contains(img.box, boxOf(localPads(fp))), JSON.stringify(img.box))
  assert.ok(img.box.w < 15 && Math.abs(img.box.x + img.box.w / 2) < 1, 'the footprint frame around its origin, not the board')
  assert.match(img.rest, /^land pattern \*\*pcbjs:C_0603_1608Metric\*\* · 2 pads · .* · placed as C1/)
})

test('usb3-hub: every hover kind has its image, each render under 50 ms', async () => {
  await demo.close()
  demo = null
  const hub = await session(join(EXAMPLES, 'usb3-hub'), [''])
  try {
    const s = hub.sites[''], d = await hub.open(join(EXAMPLES, 'usb3-hub', 'pcb.tsx'))
    const times = []
    const look = async (needle, delta = 0, n = 0) => { const h = await hub.hover(d, needle, delta, n); times.push([needle, h.ms]); return image(h.value) }
    // placement
    const ldo = await look('<LDO at', 6)
    const ref = s.sources['pcb.tsx'].find(r => r.refs.length === 1 && r.start[0] === posOf(d.text, '<LDO at').line + 1).refs[0]
    const fp = s.footprints.find(f => f.ref === ref)
    assert.match(ldo.rest, new RegExp(`^\\*\\*${ref}\\*\\* `))
    assert.ok(fp && contains(ldo.box, { x0: fp.bbox.x, y0: fp.bbox.y, x1: fp.bbox.x + fp.bbox.w, y1: fp.bbox.y + fp.bbox.h }))
    // route chain and path commands, pour, via, text
    // a chain command with no range of its own shows the route call it belongs to
    const chain = await look('.V(33)', 2)
    assert.ok(contains(chain.box, itemsBox(s, i => rangeIds(s, 'pcb.tsx', d, 'route([J0.B2', 1).has(i.id))))
    for (const [needle, delta, n] of [['pour(V1V2', 1, 0], ['via(P.VBUS', 1, 0], ['<text layer="F.SilkS" at="65.5 28.6"', 2, 0]]) {
      const ids = rangeIds(s, 'pcb.tsx', d, needle, delta, n)
      const img = await look(needle, delta, n)
      assert.ok(contains(img.box, itemsBox(s, i => ids.has(i.id))), `${needle}: ${JSON.stringify(img.box)}`)
    }
    // a pad
    const pad = await look("E0.pad('4')", 8)
    assert.match(pad.alt, /^pad on /)
    assert.match(pad.rest, /^pad \*\*E0\.4\*\*/)
    // nets: UP.DP is the net UP/DP, GND the ground of the whole board
    const dp = await look('UP.DP, DM_UP', 4)
    assert.match(dp.rest, /^net \*\*UP\/DP\*\* · class usb · /)
    assert.ok(contains(dp.box, itemsBox(s, i => i.net === 'UP/DP')))
    const gnd = await look('pour(GND', 6)
    assert.ok(contains(gnd.box, itemsBox(s, i => i.net === 'GND' && i.kind !== 'zone')))
    // factory calls: the call itself, and a factory assigned to a name
    const c = await look("C0402('100n')", 2)
    assert.match(c.rest, /^land pattern \*\*pcbjs:C_0402_1005Metric\*\*/)
    const qfn = await look('QFN(64', 1)
    assert.match(qfn.rest, /^land pattern \*\*\S+\*\* · 81 pads · .* · placed as U1/)
    assert.ok(contains(qfn.box, boxOf(localPads(s.footprints.find(f => f.ref === 'U1')))))
    // a model path: the land pattern under it, and a note that the 3D model is not drawn
    const model = await look("'./models/SOT-23-5.step'", 4)
    assert.match(model.rest, /^model `models\/SOT-23-5\.step` on /)
    assert.match(model.rest, /3D model itself is not drawn/)
    // the renders themselves, uncached, against the 50 ms budget
    const specs = [{ refs: ['U1'] }, { net: 'GND' }, { net: 'VBUS' }, { ids: s.items.filter(i => i.kind === 'zone').map(i => i.id) }, { frame: 'U1' }]
    const render = specs.map(spec => { const fresh = structuredClone(s); const t0 = performance.now(); renderPreview(fresh, spec); return performance.now() - t0 })
    console.log(`usb3-hub hover round trips ms: ${times.map(([k, t]) => `${k.slice(0, 16)} ${t.toFixed(1)}`).join(', ')}`)
    console.log(`usb3-hub renders ms, cold board index included: ${render.map(t => t.toFixed(1)).join(', ')}`)
    for (const t of render) assert.ok(t < 50, `a render took ${t.toFixed(1)} ms`)
    // cached: the same hover again comes from the cache
    const t0 = performance.now(); await hub.hover(d, 'pour(GND', 6); assert.ok(performance.now() - t0 < 50)
  } finally {
    await hub.close()
  }
})

test('a keepout call shows its rings', async () => {
  const board = `import PCB, { keepout } from '@pcbjs/core'
export default (
  <PCB name="Keep">
    <path layer="Edge.Cuts" d="M 0 0 H 30 V 20 H 0 Z" />
    {keepout('F.Cu', 'M 10 5 H 20 V 15 H 10 Z', { pours: false })}
  </PCB>
)
`
  const project = makeProject(board)
  const k = await session(project.root, [''])
  try {
    const d = await k.open(project.main)
    const img = image((await k.hover(d, 'keepout(', 2)).value)
    assert.ok(contains(img.box, { x0: 10, y0: 5, x1: 20, y1: 15 }), JSON.stringify(img.box))
    assert.match(img.rest, /^keepout on F\.Cu · keeps out tracks, vias/)
  } finally {
    await k.close()
    rmSync(project.root, { recursive: true, force: true })
  }
})

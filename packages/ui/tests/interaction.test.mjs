// Representative compiled-board selection, source attribution and isolation contracts.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { boards } from './interaction-boards.mjs'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { click, clickTarget, drawnOf, editNodeOf, emptySelection, escape, hoverOf, instancesOf, isolate, isolationName, isolationView, selectRefs } =
  await import('../src/selection.ts')
const { toolsOf, toolsWhy } = await import('../src/edit-client.ts')
const { endsIn } = await import('../src/ends.ts')
const { memberRange, netDecl } = await import('@pcbjs/cli/internal/selection')

const plain = { shift: false, deep: false },
  deep = { shift: false, deep: true }
const RW = { mode: 'rw', editor: true }

let all, B, F
before(async () => {
  all = await boards()
  B = all.Blinky
  F = all.Fx
})
after(() => all?.done())

const item = (b, pred) => b.site.items.find(pred)
const centre = it => [(it.box[0] + it.box[2]) / 2, (it.box[1] + it.box[3]) / 2]
/** A hit as the 2D and 3D views report an item under the pointer. */
const hitOf = (it, at = centre(it)) => ({ kind: it.kind, id: it.id, ref: it.ref ?? null, net: it.net ?? null, pad: null, at })
const padOf = (b, ref, net) => item(b, i => i.kind === 'pad' && i.ref === ref && (!net || i.net === net))
const trackOf = (b, route, pick = () => true) => item(b, i => i.kind === 'track' && i.route === route && pick(i))
const sel0 = b => emptySelection(b.site.name)
const iso = (b, ref) => ({ ...sel0(b), isolate: { ref, context: ref, instances: ['CH1', 'CH2', 'CH3'], preview: false }, level: ref })

/** Everything a click resolves: the target a hover lights, the selection, what it draws, the tools and why not, where the editor goes. */
function resolve(b, hit, { mods = plain, sel = sel0(b), view = '2d', mode = RW } = {}) {
  const hover = clickTarget(sel, b.site, hit, mods.deep)
  const next = click(sel, b.site, hit, mods)
  const d = drawnOf(b.site, next)
  const node = editNodeOf(b.site, next.anchor)
  const kind = kindOf(b, next.anchor)
  const tools = mode.mode === 'rw' && node ? toolsOf(node.caps).map(t => t.id) : []
  const range = next.anchor ? memberRange(b.board, next.anchor, { view, decl: decl(b) }) : null
  return { hover, sel: next, drawn: d, context: d.context, tools, why: toolsWhy(kind, node, mode), editor: range && lineOf(range), place: !!range?.place }
}
function kindOf(b, ref) {
  if (!ref) return null
  if (ref.startsWith('route:') || ref.includes('/route:')) return /\/leg:\d+$/.test(ref) ? 'leg' : /\/pt:\d+$/.test(ref) ? 'pt' : 'route'
  for (const k of ['net', 'plane', 'drc', 'erc', 'item']) if (ref.startsWith(k + ':')) return k
  return b.site.schematic.circuits.some(c => c.path.join('/') === ref) ? 'group' : /\/\d+$/.test(ref) ? 'pad' : 'part'
}
/** Where a net is declared, as the session finds it. */
const decl = b => net => netDecl(b.board, net, f => all.text(f.slice(all.root.length + 1)), join(all.root, `${b.board.name.toLowerCase()}.pcb.tsx`), all.root)
/** The source line a range starts on, trimmed. */
const lineOf = r =>
  all
    .text(r.file.startsWith('/') ? r.file.slice(all.root.length + 1) : r.file)
    .split('\n')
    [r.line - 1].trim()

test('part inside an instance: the instance, its at, no context, move ring R flip of the instance', () => {
  const r = resolve(B, hitOf(padOf(B, 'R2')))
  assert.equal(r.hover, 'CH2')
  assert.deepEqual(r.sel.refs, ['CH2'])
  assert.deepEqual([...r.drawn.parts].sort(), ['D2', 'R2'])
  assert.equal(r.context, null)
  assert.match(r.editor, /^<LedChannelRow g=\{CH2\} at="16 10"/)
  assert.ok(r.place)
  // the layout element's at is the instance's placement
  assert.deepEqual(r.tools, ['move', 'rotate', 'layer'])
  assert.equal(r.why, null)
  assert.deepEqual(editNodeOf(B.site, 'CH2').at, [16, 10, 0])
})

test('track or via of a bound route: the whole route, its chain call, its net, the points tool', () => {
  const t = trackOf(F, 'route:trunk', i => centre(i)[0] < 8)
  const r = resolve(F, hitOf(t))
  assert.equal(r.hover, 'route:trunk')
  assert.deepEqual(r.sel.refs, ['route:trunk'])
  assert.deepEqual(
    [...r.drawn.ids].sort(),
    F.site.items
      .filter(i => i.route === 'route:trunk')
      .map(i => i.id)
      .sort(),
  )
  assert.equal(r.context, 'VCC')
  assert.match(r.editor, /^const trunk = route\('3 12\.54'\)/)
  assert.deepEqual(r.tools, ['point'])
  // a via of a chain picks its route too
  const via = item(B, i => i.kind === 'via' && i.route === 'route:15')
  assert.equal(resolve(B, hitOf(via)).sel.anchor, 'route:15')
})

test('track of an automatic leg: the leg’s route, its declaration, its net', () => {
  const r = resolve(B, hitOf(trackOf(B, 'route:16')))
  assert.equal(r.hover, 'route:16')
  assert.deepEqual(r.sel.refs, ['route:16'])
  assert.equal(r.context, 'GND')
  assert.match(r.editor, /^\{route\(Q1\[2\], '25 12\.5 B\.Cu'\)/)
})

test('a text a layout draws for each instance has no element of its own: no placement', () => {
  const label = item(B, i => i.kind === 'text' && i.path === 'CH1')
  assert.deepEqual(resolve(B, hitOf(label)).sel.refs, ['CH1'], 'on the board it is part of its instance')
  const r = resolve(B, hitOf(label), { sel: iso(B, 'CH1') })
  assert.equal(r.sel.anchor, label.uid)
  assert.deepEqual(r.tools, [])
  assert.equal(r.why, 'no placement')
})

test('schematic pin: the part, with cmd or ctrl the pad; the part’s schematic at', () => {
  const pin = { kind: 'pin', ref: 'J1', pad: '2', net: 'VCC' }
  const r = resolve(B, pin, { view: 'sch' })
  assert.equal(r.hover, 'J1')
  assert.deepEqual(r.sel.refs, ['J1'])
  const d = resolve(B, pin, { view: 'sch', mods: deep })
  assert.deepEqual(d.sel.refs, ['J1/2'])
  assert.match(d.editor, /^<J1 at="4 7" \/>$/)
})

test('context only for a copper anchor: a pad, a track, a via or a route draws its net, the rest none', () => {
  const ctx = ref => drawnOf(B.site, selectRefs(sel0(B), [ref])).context
  assert.equal(ctx('J1/2'), 'VCC')
  assert.equal(ctx('route:14'), 'SW')
  assert.equal(ctx(item(B, i => i.kind === 'via').uid), item(B, i => i.kind === 'via').net)
  for (const ref of ['J1', 'CH2', 'CH2/R', 'plane:B.Cu:GND', item(B, i => i.kind === 'text' && !i.ref).uid]) assert.equal(ctx(ref), null, ref)
  const f = F.site.drc[0].id
  assert.equal(drawnOf(F.site, selectRefs(sel0(F), [f])).context, null, 'a finding')
})

test('an instance lights as a whole: its parts, the routes its layout made and the text it drew, one outline, no context', () => {
  const s = click(sel0(B), B.site, hitOf(padOf(B, 'R1')), plain)
  assert.deepEqual(s.refs, ['CH1'])
  const d = drawnOf(B.site, s)
  assert.deepEqual([...d.parts].sort(), ['D1', 'R1'])
  const routes = B.site.routes.filter(r => r.path === 'CH1').map(r => r.id)
  assert.equal(routes.length, 3)
  for (const it of B.site.items.filter(i => routes.includes(i.route))) assert.ok(d.ids.has(it.id), `${it.route} ${it.id}`)
  const label = B.site.items.find(i => i.kind === 'text' && i.path === 'CH1')
  assert.ok(label && d.ids.has(label.id), 'the LED1 text')
  assert.ok(!B.site.items.some(i => d.ids.has(i.id) && i.route && !routes.includes(i.route)), 'no copper of another instance or the board')
  assert.equal(d.context, null)
  assert.deepEqual(d.nets.size, 0)
  // the hover lights the same set
  const h = hoverOf(B.site, clickTarget(sel0(B), B.site, hitOf(padOf(B, 'D1')), false))
  assert.deepEqual(new Set(h.ids), d.ids)
  assert.deepEqual(h.refs.sort(), ['D1', 'R1'])
  assert.match(resolve(B, hitOf(padOf(B, 'R1'))).editor, /^<LedChannelRow g=\{CH1\} at="16 5" label="LED1" \/>$/)
})

test('two circuits named alike in two files are two definitions; a nested instance isolates in its frames and leaves to its parent', () => {
  const N = all.Nx
  assert.deepEqual(instancesOf(N.site, 'TA1'), ['TA1'], 'cell of twin-a.ts never merges with cell of twin-b.ts at the same depth')
  assert.deepEqual(instancesOf(N.site, 'TB2'), ['TB2'])
  assert.deepEqual(instancesOf(N.site, 'P1'), ['P1', 'P2'])
  assert.deepEqual(instancesOf(N.site, 'P1/A1'), ['P1/A1', 'P1/B2', 'P2/A1', 'P2/B2'], 'Row lays out four channels through two levels')
  let s = isolate(selectRefs(sel0(N), ['P2/B2']), N.site)
  assert.equal(s.isolate.ref, 'P2/B2')
  const v = isolationView(N.site, s.isolate)
  assert.deepEqual(v.frame, [0, -1, 1, 0, 24, 5], 'P2 at 20 5 90 composed with B2 at 0 4')
  assert.equal(isolationName(N.site, s.isolate), 'Row')
  s = escape(s, N.site)
  assert.deepEqual([s.isolate?.ref, s.refs], ['P2', ['P2/B2']], 'Escape at a nested root goes to the parent definition with the instance selected')
  s = escape(s, N.site)
  assert.deepEqual([s.isolate, s.refs], [null, ['P2']], 'then to the board')
})

test('a route end slot read through CH1 is carried into the isolated CH2: refs, net and points', () => {
  const pad = B.site.footprints.find(f => f.ref === 'D1').pads.find(p => p.net === 'CH1/led')
  const ctx = {
    board: 'Blinky',
    pad: 'R1/2',
    net: 'CH1/led',
    ends: {
      slot: 1,
      append: false,
      net: 'CH1/led',
      candidates: [{ handle: 'g.D.A', label: `${pad.num} · CH1/led`, kind: 'pad', ref: `D1/${pad.num}`, net: 'CH1/led', at: pad.at, side: 'F' }],
    },
  }
  const out = endsIn(ctx, B.site, { ref: 'CH2', context: 'CH2', instances: ['CH1', 'CH2', 'CH3'], preview: false })
  const d2 = B.site.footprints.find(f => f.ref === 'D2').pads.find(p => p.net === 'CH2/led')
  assert.deepEqual([out.pad, out.net, out.ends.net], ['R2/2', 'CH2/led', 'CH2/led'])
  const [c] = out.ends.candidates
  assert.deepEqual([c.handle, c.ref, c.net, c.label], ['g.D.A', `D2/${d2.num}`, 'CH2/led', `${d2.num} · CH2/led`])
  assert.deepEqual(
    c.at.map(v => Math.round(v * 1e6) / 1e6),
    d2.at,
  )
})

// The interaction contract, row by row and invariant by invariant, through the pure resolvers the 2D, 3D and schematic views share:
// what a hover lights, what a click selects per level and modifier, what the selection draws and its context, which tools the anchor
// takes and why not, and where the editor goes, on Blinky and on Fx, a scratch board with an instance, a bound route with an automatic
// leg, a pour, a text and an unconnected net, both compiled as the session compiles them. docs/viewer.md has the public tables.
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
const { click, clickTarget, drawnOf, editNodeOf, emptySelection, enter, escape, hoverOf, instancesOf, isolate, isolationName, isolationView, selectRefs } =
  await import('../src/selection.ts')
const { reachOf, shownDef } = await import('@pcbjs/core/internal/instances')
const { jumpButtons, toolsOf, toolsWhy, editClient, sessionMismatch, writtenText } = await import('../src/edit-client.ts')
const { fakeTransport } = await import('./fake-transport.mjs')
const { PROTOCOL, MAJOR } = await import('@pcbjs/core/protocol')
const { refSource } = await import('../src/defs.ts')
const { dragMods, onAxis, snapPoint } = await import('../src/snap.ts')
const { dotField, nearest, pickText } = await import('../src/dots.ts')
const { endsIn, nearestEnd } = await import('../src/ends.ts')
const { schMarks } = await import('../src/schview.ts')
const { uidsOf } = await import('../src/refs.ts')
const { memberRange, netDecl } = await import('@pcbjs/cli/internal/selection')

const plain = { shift: false, deep: false },
  deep = { shift: false, deep: true },
  shift = { shift: true, deep: false }
const RW = { mode: 'rw', editor: true },
  RO = { mode: 'ro', editor: false }

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

// ---- per entity, plain click, 2D and 3D ----

test('part body or pad outside any instance: the part, its at, no context, move ring R flip', () => {
  for (const hit of [hitOf(padOf(B, 'J1', 'VCC')), { kind: 'body', ref: 'J1', at: null }]) {
    const r = resolve(B, hit)
    assert.equal(r.hover, 'J1', 'the hover lights the part')
    assert.deepEqual(r.sel.refs, ['J1'])
    assert.deepEqual([...r.drawn.parts], ['J1'])
    assert.equal(r.context, null)
    assert.equal(
      r.editor,
      all
        .text('blinky.pcb.tsx')
        .split('\n')
        .find(line => /^\s*<J1 at=/.test(line))
        .trim(),
    )
    assert.ok(r.place, 'the cursor lands on its at')
    assert.deepEqual(r.tools, ['move', 'rotate', 'layer'])
    assert.equal(r.why, null)
  }
})

test('pad with cmd or ctrl: the pad, the part’s at, its net as context, no tools', () => {
  const r = resolve(B, hitOf(padOf(B, 'J1', 'VCC')), { mods: deep })
  assert.equal(r.hover, 'J1/2')
  assert.deepEqual(r.sel.refs, ['J1/2'])
  assert.deepEqual([...r.drawn.ids], [padOf(B, 'J1', 'VCC').id])
  assert.equal(r.context, 'VCC')
  assert.match(r.editor, /^<J1 at=/)
  assert.deepEqual(r.tools, [])
  assert.equal(r.why, 'select a part')
})

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

test('part inside the selected instance enters isolation: the definition with the part selected, its layout call, its tools', () => {
  const r = resolve(B, hitOf(padOf(B, 'R2')), { sel: { ...sel0(B), refs: ['CH2'], anchor: 'CH2' } })
  assert.equal(r.hover, 'CH2/R')
  assert.deepEqual(r.sel.refs, ['CH2/R'])
  assert.deepEqual(r.sel.isolate, { ref: 'CH2', context: 'CH2', instances: ['CH1', 'CH2', 'CH3'], preview: false })
  assert.deepEqual([...r.drawn.parts], ['R2'])
  assert.equal(r.context, null)
  assert.match(r.editor, /^<LedChannelRow g=\{CH2\} at="16 10"/)
  assert.deepEqual(r.tools, ['move', 'rotate', 'layer'])
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

test('leg with cmd or ctrl: the leg alone, the chain call, its net', () => {
  const leg = trackOf(F, 'route:trunk', i => centre(i)[0] > 9 && centre(i)[0] < 14)
  const drawn = trackOf(F, 'route:trunk', i => centre(i)[0] < 8)
  const r = resolve(F, hitOf(leg), { mods: deep })
  assert.equal(r.hover, 'route:trunk/leg:1')
  assert.deepEqual(r.sel.refs, ['route:trunk/leg:1'])
  assert.ok(r.drawn.ids.has(leg.id) && !r.drawn.ids.has(drawn.id), 'only the leg’s copper')
  assert.equal(r.context, 'VCC')
  assert.match(r.editor, /^const trunk = route\(/)
  assert.deepEqual(r.tools, ['point'], 'the leg handle of the points tool')
  // a drawn call of the same route is no leg: cmd or ctrl selects the route
  assert.equal(resolve(F, hitOf(drawn), { mods: deep }).sel.anchor, 'route:trunk')
})

test('pour: the plane, its pour call, no context, no tools', () => {
  const r = resolve(B, hitOf(item(B, i => i.kind === 'zone')))
  assert.equal(r.hover, 'plane:B.Cu:GND')
  assert.deepEqual(r.sel.refs, ['plane:B.Cu:GND'])
  assert.equal(r.context, null)
  assert.deepEqual(r.drawn.nets.size, 0, 'the plane lights its pour, not its net')
  assert.match(r.editor, /^\{pour\(GND, 'B\.Cu', rect\(W, H\)\)\}$/)
  assert.equal(r.why, 'select a part')
})

test('text or graphic: the item, its element, no context', () => {
  const text = item(F, i => i.kind === 'text' && !i.ref)
  const r = resolve(F, hitOf(text))
  assert.equal(r.hover, text.uid)
  assert.deepEqual(r.sel.refs, [text.uid])
  assert.equal(r.context, null)
  assert.match(r.editor, /^<text layer="F\.SilkS" at="15 18\.5" size=\{1\}>$/)
  assert.deepEqual(r.tools, ['move', 'rotate'], 'its element takes an at with a rotation, no side')
})

test('a text a layout draws for each instance has no element of its own: no placement', () => {
  const label = item(B, i => i.kind === 'text' && i.path === 'CH1')
  assert.deepEqual(resolve(B, hitOf(label)).sel.refs, ['CH1'], 'on the board it is part of its instance')
  const r = resolve(B, hitOf(label), { sel: iso(B, 'CH1') })
  assert.equal(r.sel.anchor, label.uid)
  assert.deepEqual(r.tools, [])
  assert.equal(r.why, 'no placement')
})

test('ratsnest line: its net, the net’s declaration, the net drawn', () => {
  const r = resolve(F, { kind: 'rats', net: 'U', at: [22, 16] })
  assert.equal(r.hover, 'net:U')
  assert.deepEqual(r.sel.refs, ['net:U'])
  assert.deepEqual([...r.drawn.nets], ['U'])
  assert.match(r.editor, /^export const \{ GND, VCC, SW, U \} = nets\(\)$/)
})

test('finding: the finding, its first witness, no context', () => {
  const f = F.site.drc.find(d => d.rule === 'unconnected' && (d.refs ?? []).includes('R5/1'))
  const next = selectRefs({ ...sel0(F), level: null }, [f.id])
  const d = drawnOf(F.site, next)
  assert.deepEqual(next.refs, [f.id])
  assert.equal(d.context, null)
  assert.match(lineOf(memberRange(F.board, f.id)), /^<R5 at="20 16" \/>$/)
})

test('route end candidate and assist dot: the pick resolves, the selection stays', () => {
  const ends = {
    board: 'Fx',
    command: 'end',
    ends: {
      slot: 1,
      append: false,
      net: 'U',
      candidates: [{ handle: 'R6[1]', label: '1 · U', kind: 'pad', ref: 'R6/1', num: '1', net: 'U', at: [25.175, 16], side: 'F' }],
    },
  }
  assert.equal(nearestEnd(ends, [25.2, 16.05], 0.3)?.handle, 'R6[1]')
  assert.equal(nearestEnd(ends, [22, 16], 0.3), null)
  const ctx = {
    board: 'Fx',
    command: 'H',
    relative: false,
    ref: null,
    start: [3, 12.54],
    pad: null,
    layer: 'F.Cu',
    net: 'VCC',
    side: 'F',
    grid: null,
    width: 0.3,
    typed: [],
    open: false,
  }
  const dot = nearest(dotField(ctx, F.site), [7.1, 12.6], 0.3)
  assert.deepEqual(dot.at, [7, 12.54])
  assert.equal(pickText(ctx, dot.at), '.H(7)')
})

test('empty board: the members clear, the isolation stays', () => {
  const s = click({ ...iso(B, 'CH2'), refs: ['CH2/R'], anchor: 'CH2/R' }, B.site, null, plain)
  assert.deepEqual(s.refs, [])
  assert.equal(s.anchor, null)
  assert.equal(s.isolate.ref, 'CH2')
  assert.equal(clickTarget(sel0(B), B.site, null, false), null, 'nothing lights')
})

// ---- per entity, schematic ----

test('schematic symbol: the part, its schematic at', () => {
  const r = resolve(B, { kind: 'body', ref: 'J1' }, { view: 'sch' })
  assert.deepEqual(r.sel.refs, ['J1'])
  assert.match(r.editor, /^<J1 at="4 7" \/>$/)
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

test('schematic wire or label: the net, its declaration', () => {
  for (const kind of ['wire', 'label']) {
    const r = resolve(B, { kind, net: 'SIG' }, { view: 'sch' })
    assert.deepEqual(r.sel.refs, ['net:SIG'])
    assert.match(r.editor, /^export const \{ GND, VCC, SIG, SW \} = nets\(\)$/)
  }
})

test('schematic sheet: the instance, its sheet placement', () => {
  const r = resolve(B, { kind: 'sheet', ref: 'CH2' }, { view: 'sch' })
  assert.deepEqual(r.sel.refs, ['CH2'])
  assert.match(r.editor, /^<Sheet group=\{ch\} at=\{`23 \$\{y\}`\}>$/)
})

// ---- invariants ----

const HITS = () => [
  [B, hitOf(padOf(B, 'J1', 'VCC'))],
  [B, hitOf(padOf(B, 'R2'))],
  [B, hitOf(trackOf(B, 'route:16'))],
  [B, hitOf(item(B, i => i.kind === 'zone'))],
  [F, hitOf(trackOf(F, 'route:trunk'))],
  [F, hitOf(item(F, i => i.kind === 'text' && !i.ref))],
  [F, { kind: 'rats', net: 'U', at: [22, 16] }],
]

test('one hover lights one entity, the one a plain click selects, without context, and tells the other views no more', () => {
  for (const [b, hit] of HITS())
    for (const mods of [plain, deep]) {
      const target = clickTarget(sel0(b), b.site, hit, mods.deep)
      assert.equal(target, click(sel0(b), b.site, hit, mods).anchor)
      const h = hoverOf(b.site, target)
      const isNet = target.startsWith('net:')
      assert.equal(h.net, isNet ? target.slice(4) : null, `${target}: a net only when it is the target`)
      // the schematic marks what the board hover stands for, never the net of a part or a pad
      const marks = schMarks(b.site.schematic.drawing ?? { symbols: [] }, { ...h, uids: uidsOf(b.site, h.ids) })
      if (!isNet) assert.deepEqual(marks.nets, [], target)
    }
  assert.deepEqual(hoverOf(B.site, null), { refs: [], ids: [], net: null }, 'the hover clears with the pointer')
})

test('one click: one selection, one anchor, one editor range', () => {
  for (const [b, hit] of HITS()) {
    const r = resolve(b, hit)
    assert.equal(r.sel.refs.length, 1)
    assert.equal(r.sel.anchor, r.sel.refs[0])
    assert.equal(typeof r.editor, 'string', `${r.sel.anchor} has a place in the code`)
  }
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

test('an item lights its own copper, never the merged net it belongs to', () => {
  for (const ref of ['J1/2', 'route:14', 'route:trunk/leg:1', item(B, i => i.kind === 'via').uid]) {
    const b = ref.includes('trunk') ? F : B
    const d = drawnOf(b.site, selectRefs(sel0(b), [ref]))
    assert.equal(d.nets.size, 0, ref)
    assert.ok(d.ids.size > 0, ref)
  }
  assert.deepEqual([...drawnOf(B.site, selectRefs(sel0(B), ['net:VCC'])).nets], ['VCC'], 'a net lights its merged copper')
})

test('modifiers: shift toggles, cmd or ctrl the leaf, double-click enters isolation, Escape leaves it then clears, empty board keeps it', () => {
  const pad = hitOf(padOf(B, 'R2'))
  let s = click(sel0(B), B.site, pad, plain)
  s = click(s, B.site, hitOf(padOf(B, 'J1', 'VCC')), shift)
  assert.deepEqual(s.refs, ['CH2', 'J1'])
  s = click(s, B.site, hitOf(padOf(B, 'J1', 'VCC')), shift)
  assert.deepEqual(s.refs, ['CH2'], 'shift again takes it out')
  assert.deepEqual(click(sel0(B), B.site, pad, deep).refs, ['CH2/R/1'])
  const e = enter(sel0(B), B.site, pad)
  assert.equal(e.isolate.ref, 'CH2')
  assert.deepEqual(e.refs, ['CH2/R'])
  const up = escape(e, B.site)
  assert.equal(up.isolate, null)
  assert.deepEqual(up.refs, ['CH2'])
  assert.deepEqual(escape(up, B.site).refs, [])
  assert.equal(click(e, B.site, null, plain).isolate.ref, 'CH2')
})

test('alt-click: the entity a plain click selects, its definition, factory or declaration, in the editor; the selection kept', () => {
  const def = (b, ref) => {
    const t = refSource(b.site, ref, 'definition')
    return t && `${t.file}: ${all.text(t.file).split('\n')[t.start[0] - 1].trim()}`
  }
  const alt = { ...plain, alt: true }
  const cases = [
    // a part of no instance: its declaration
    [hitOf(padOf(B, 'J1', 'VCC')), sel0(B), 'J1', /^blinky\.sch\.tsx: export const J1 = /],
    // a part inside an instance: the instance, the render of its layout
    [hitOf(padOf(B, 'R2')), sel0(B), 'CH2', /^lib\/led-channel\.tsx: <g at=\{at\} side=\{side\}>/],
    // inside the isolated definition: the part, its declaration in the circuit
    [hitOf(padOf(B, 'R2')), iso(B, 'CH2'), 'CH2/R', /^lib\/led-channel\.tsx: /],
  ]
  for (const [hit, sel, ref, where] of cases) {
    const r = resolve(B, hit, { sel })
    assert.equal(clickTarget(sel, B.site, hit, alt.deep), ref, 'the same entity a plain click selects')
    assert.equal(r.hover, ref)
    assert.match(def(B, ref), where)
  }
  // a pick never moves the selection: page.ts opens the definition and returns before the click
  assert.equal(refSource(B.site, 'J1', 'definition').file, 'blinky.sch.tsx')
})

test('jump buttons: none on the chip with an editor attached, a click and an alt-click jump it; a page without one keeps both', () => {
  assert.equal(jumpButtons(RW), false)
  assert.equal(jumpButtons({ mode: 'ro', editor: true }), false)
  assert.equal(jumpButtons(RO), true)
  assert.equal(jumpButtons(null), true, 'a built site or a standalone page with no session')
})

test('tools only for a placeable anchor in a read-write session, else the chip says why', () => {
  const placed = { caps: ['placed', 'layered'] }
  assert.equal(toolsWhy('part', placed, RW), null)
  assert.equal(toolsWhy('part', placed, RO), 'read-only')
  assert.equal(toolsWhy('group', null, RW), 'no placement')
  assert.equal(toolsWhy('group', { caps: [], computed: true }, RW), 'its at is computed; set it in the source')
  assert.equal(toolsWhy('item', null, RW), 'no placement')
  assert.equal(toolsWhy('route', { caps: ['chain'] }, RW), null)
  for (const k of ['pad', 'net', 'plane', 'drc']) assert.equal(toolsWhy(k, null, RW), 'select a part', k)
  assert.equal(toolsWhy(null, null, RW), null, 'nothing selected')
  assert.equal(toolsWhy('part', { caps: ['placed'] }, null), null, 'no session: no tools and no note')
  assert.deepEqual(resolve(B, hitOf(padOf(B, 'J1', 'VCC')), { mode: RO }).tools, [], 'a read-only session shows none')
})

test('every write goes through session/edit: the client sends nothing else, never changes the board, and names the files a write applied', async () => {
  const t = fakeTransport(m => ({ written: m === 'session/edit/commit' ? [{ file: '/p/quad.pcb.tsx', via: 'editor', applied: true }] : [] }))
  const wrote = []
  const c = editClient(t, undefined, files => wrote.push(writtenText(files)))
  await Promise.all([
    c.begin({ board: 'Blinky', tool: 'move', refs: ['J1'], anchor: 'J1' }),
    c.update('edit1', { delta: [2, 0] }),
    c.commit('edit1'),
    c.cancel('edit1'),
    c.undo('edit1', false),
  ])
  assert.deepEqual(
    t.sent.map(s => s[0]),
    ['session/edit/begin', 'session/edit/update', 'session/edit/commit', 'session/edit/cancel', 'session/edit/undo'],
  )
  assert.deepEqual(wrote, ['Written quad.pcb.tsx in the editor'])
})

// ---- edit gestures ----

test('a drag snaps to the grid in effect, shift free, cmd or ctrl locked to its axis', () => {
  const g = { name: 'g', pitch: 1, minor: [], origin: [0, 0], angle: 0, mirror: false }
  assert.deepEqual(snapPoint(g, [5.3, 6.7], dragMods(false, false)), [5, 7])
  assert.deepEqual(snapPoint(g, [5.3, 6.7], dragMods(true, false)), [5.3, 6.7], 'shift: free')
  const m = dragMods(false, true)
  assert.equal(m.axis, true)
  assert.deepEqual(onAxis([3, 7], snapPoint(g, [5.3, 7.4], m)), [5, 7], 'cmd or ctrl: along the axis it moved most')
  assert.deepEqual(onAxis([3, 7], [3.2, 9]), [3, 9])
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

test('a session older than the viewer is said in a banner, never left to fail silently', () => {
  assert.equal(sessionMismatch({ version: '0.0.1-beta.2', protocol: PROTOCOL, major: MAJOR }), null)
  assert.equal(sessionMismatch({ version: '0.0.1-beta.1', protocol: PROTOCOL - 1, major: MAJOR }), 'session 0.0.1-beta.1 is older than the viewer, restart it')
  assert.equal(sessionMismatch({ version: '2.0.0', protocol: PROTOCOL, major: MAJOR + 1 }), 'session 2.0.0 speaks a newer protocol than the viewer, reload the page')
  assert.equal(sessionMismatch({ version: '0.0.1-beta.1' }), 'session 0.0.1-beta.1 is older than the viewer, restart it', 'an old session sends no protocol')
})

test('isolation of CH1 in Blinky: the definition in its frame with CH1’s values, the board and CH2, CH3 hidden; Fx’s one instance keeps the board faded', () => {
  const s = isolate(selectRefs(sel0(B), ['CH1/R']), B.site)
  const v = isolationView(B.site, s.isolate)
  assert.deepEqual(v.frame, [1, 0, 0, 1, 16, 5], 'the layout frame at <LedChannelRow g={CH1} at="16 5">')
  assert.deepEqual([...v.parts].sort(), ['D1', 'R1'])
  const label = item(B, i => i.kind === 'text' && i.path === 'CH1')
  assert.ok(v.ids.has(label.id) && v.ids.has(trackOf(B, B.site.routes.find(r => r.path === 'CH1')?.id ?? '', () => true)?.id ?? -1), 'its text and its tracks')
  assert.ok(!v.ids.has(padOf(B, 'R2').id) && !v.ids.has(padOf(B, 'J1', 'VCC').id), 'no other instance, no board part')
  assert.equal(v.fade, false)
  // The centered definition frame holds R1 at -4 and D1 at 4.
  assert.ok(v.box[0] < -4 && v.box[0] + v.box[2] > 4 && v.box[1] < 0 && v.box[1] + v.box[3] > 0, JSON.stringify(v.box))
  assert.equal(isolationName(B.site, s.isolate), 'LedChannelRow')
  const f = isolate(selectRefs(sel0(F), ['CH2']), F.site)
  const fv = isolationView(F.site, f.isolate)
  assert.equal(fv.fade, true, 'placed once: the board stays, faded')
  assert.deepEqual(fv.frame, [1, 0, 0, 1, 0, 4])
  assert.equal(isolationName(F.site, f.isolate), 'Row')
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

test('isolated instance membership agrees with shared edit reach across fixture boards', () => {
  for (const b of [B, F, all.Nx]) {
    const cs = b.site.schematic.circuits
    for (const c of cs) {
      const ref = c.path.join('/')
      const follow = instancesOf(b.site, ref).length
      const nodes = (b.site.edit ?? []).filter(e => e.def === shownDef(c) && e.frames?.at(-1)?.inst === ref)
      for (const n of nodes) assert.equal(reachOf(cs, n.def).length, follow, `${b.site.name} ${ref} ${n.ref}`)
    }
  }
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

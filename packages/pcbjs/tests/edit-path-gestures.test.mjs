// The edit path's gestures on Quad through the editor, each written once at its point of instantiation; the harness is edit-path-harness.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  harness,
  S,
  SAMPLE,
  BODY,
  SCREEN3,
  show,
  TEXT0,
  centre,
  chip,
  click,
  compiles,
  confirmations,
  dblclick,
  drag,
  ed,
  ev,
  gesture,
  key,
  mouse,
  onText,
  page,
  quad,
  screenOf,
  settled,
  skip,
  sleep,
  until,
} from './edit-path-harness.mjs'

harness()

test('a click on J1 selects it and its source expression, focus kept', { skip }, async () => {
  await settled()
  await click(await screenOf(3, 8.77))
  await until('the chip', async () => (await chip()).startsWith('J1'))
  await until('pcbjs/select', () => ed.selects.length).catch(e => {
    throw new Error(`${e.message}\n${S.log.text}`)
  })
  const s = ed.selects.at(-1)
  const r = s.items[0].ranges[s.primary.index]
  assert.equal(TEXT0.split('\n')[r.start.line].slice(r.start.character, r.end.character), '<J1 at="3 6.23" />', 'the range is the placement expression')
  assert.equal(s.reveal, true)
  assert.ok(!s.focus, 'the editor does not take focus')
  assert.match(await ev(`document.querySelector('.bv-edit')?.innerText ?? ''`), /Placement/)
})

test('drag J1 2 mm: its at, through the editor, never drawn where it was after the drop', { skip }, async () => {
  const from = await screenOf(3, 8.77)
  const to = await screenOf(5, 8.77)
  await ev(SAMPLE('J1'))
  const edit = await gesture('drag', () => drag(from, to))
  assert.match(ed.doc.getText(), /<J1 at="5 6\.23" \/>/, JSON.stringify(edit))
  await until('the samples', async () => (await ev('window.__xs.length')) >= 60, 6000)
  const [x0, xs] = [await ev('window.__x0'), await ev('window.__xs')]
  const moved = to[0] - from[0]
  assert.ok(moved > 20, 'a drag of more than 20 px')
  for (const [i, x] of xs.entries())
    assert.ok(x !== null && Math.abs(x - (x0 + moved)) < 2, `at ${i * 50} ms after the drop J1 is drawn at ${x}, not at ${x0 + moved}: ${JSON.stringify(xs)}`)
})

test('ring drag: its rotation in the third slot', { skip }, async () => {
  await settled()
  const knob = await centre('[data-tool=ring].knob')
  const c = await screenOf(5, 6.23)
  const rr = Math.hypot(knob[0] - c[0], knob[1] - c[1])
  // a quarter turn counter-clockwise on screen: from the knob at 0 degrees to straight up
  await gesture('ring', () => drag(knob, [c[0], c[1] - rr]))
  assert.match(ed.doc.getText(), /<J1 at="5 6\.23 90" \/>/)
})

test('R turns it 90 degrees more', { skip }, async () => {
  await gesture('R', () => key('r', 'KeyR'))
  assert.match(ed.doc.getText(), /<J1 at="5 6\.23 180" \/>/)
})

test('flip: side="B" on the same element', { skip }, async () => {
  await gesture('flip', () => ev(`(() => { const s = document.querySelector('[aria-label="Placement side"]'); s.value = 'B'; s.dispatchEvent(new Event('change')) })()`))
  assert.match(ed.doc.getText(), /<J1 at="5 6\.23 180" side="B" \/>/)
})

test('a part inside a group: a double-click enters its definition, a drag writes the part’s own at, Escape leaves', { skip }, async () => {
  await settled()
  await dblclick(await screenOf(10.825, 7.5))
  await until('R1 inside Divider', async () => /^Divider\s*\/\s*R1/.test(await chip()))
  await until('its tools', async () => /Placement/.test(await ev(`document.querySelector('.bv-edit')?.innerText ?? ''`)))
  const from = await screenOf(10.825, 7.5),
    to = await screenOf(10.825, 8.5)
  await gesture('group part', () => drag(from, to))
  assert.match(ed.doc.getText(), /<R1 at="-6 1" \/>/)
  await key('Escape', 'Escape')
  await until('back on the board with Divider selected', async () => /^Divider/.test(await chip()) && !/shown with/.test(await chip()))
})

test('save: the file on disk takes the editor text', { skip }, async () => {
  await ed.doc.save()
  assert.equal(readFileSync(quad, 'utf8'), ed.doc.getText())
})

test('drag a route point: its call argument', { skip }, async () => {
  await click(await screenOf(6.5, 6.23))
  await until('the route anchor', async () => /^route:/.test(await chip()))
  await settled()
  const pt = await centre('[data-tool=pt][data-k="1"]')
  const to = await screenOf(7, 6.23)
  await gesture('point', () => drag(pt, [to[0], pt[1]]))
  assert.match(ed.doc.getText(), /\.H\(7\)\.L\(9\.175, 7\.5\)/)
})

test('Delete on a point removes its call', { skip }, async () => {
  await settled()
  const pt = await centre('[data-tool=pt][data-k="2"]')
  await click(pt)
  await until('the point in focus', () => ev(`!!document.querySelector('[data-tool=pt][data-k="2"].on')`))
  await gesture('delete', () => key('Delete', 'Delete'))
  assert.match(ed.doc.getText(), /route\('3 6\.23'\)\.net\(VIN\)\.width\(0\.3\)\.H\(7\)\}/)
})

test('assist: with the cursor in route(J1[1], R1[1]).H(|) a click on a dot writes the argument', { skip }, async () => {
  const lines = ed.doc.getText().split('\n')
  const at = lines.findIndex(l => l.includes('.net(VIN)')) + 1
  lines.splice(at, 0, '    {route(J1[1], R1[1]).H()}')
  ed.type(lines.join('\n'))
  ed.cursor(at + 1, '    {route(J1[1], R1[1]).H('.length + 1)
  await until('the dots', () => ev(`!!document.querySelector('.assist path.dot')`), 20000)
  await sleep(300)
  const dot = await screenOf(8, 6.23)
  await gesture('assist', () => click(dot))
  assert.match(ed.doc.getText(), /\{route\(J1\[1\], R1\[1\]\)\.H\(8\)\}/)
})

test('cmd or ctrl Z undoes the last edit through the editor', { skip }, async () => {
  const mod = (await ev('navigator.platform')).startsWith('Mac') ? 4 : 2
  await gesture('undo', () => key('z', 'KeyZ', mod))
  assert.match(ed.doc.getText(), /\{route\(J1\[1\], R1\[1\]\)\.H\(\)\}/)
})

test('drag a text 2 mm: its own at', { skip }, async () => {
  await settled()
  await key('Escape', 'Escape')
  await key('Escape', 'Escape')
  const from = await onText(16, 12.5)
  await click(from)
  await until('the text selected', async () => /^item:/.test(await chip()))
  await until('its tools', async () => /Placement/.test(await ev(`document.querySelector('.bv-edit')?.innerText ?? ''`)))
  const [a, b] = [await screenOf(16, 12.5), await screenOf(18, 12.5)]
  await gesture('text', () => drag(from, [from[0] + b[0] - a[0], from[1] + b[1] - a[1]]))
  assert.match(ed.doc.getText(), /<text layer="F\.SilkS" at="18 12\.5" size=\{1\}>/)
})

test('typing the session has not seen yet during a drag: the editor refuses the write made on the older text, and the chip says why', { skip }, async () => {
  await settled()
  const from = await onText(18, 12.5)
  await click(from)
  await until('the text selected', async () => /^item:/.test(await chip()))
  await until('its tools', async () => /Placement/.test(await ev(`document.querySelector('.bv-edit')?.innerText ?? ''`)))
  const [a, b] = [await screenOf(18, 12.5), await screenOf(20, 12.5)]
  const to = [from[0] + b[0] - a[0], from[1] + b[1] - a[1]]
  const before = { applied: ed.applied.length, refused: ed.refused.length, shown: (await confirmations()).length }
  const typed = `${ed.doc.getText()}// typed during the drag\n`
  await mouse('mouseMoved', from)
  await mouse('mousePressed', from)
  for (let i = 1; i <= 8; i++) {
    await mouse('mouseMoved', [from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8], { held: true })
    await sleep(16)
  }
  ed.hold()
  ed.type(typed)
  await mouse('mouseReleased', to)
  try {
    await until('the refused applyEdit', () => ed.refused.length > before.refused)
    await until("the chip's reason", async () => (await confirmations()).length > before.shown)
  } finally {
    ed.release()
  }
  assert.match((await confirmations()).at(-1), /quad\.pcb\.tsx changed in the editor while the edit was made; nothing was written there/)
  assert.equal(ed.applied.length, before.applied, 'nothing applied')
  assert.equal(ed.doc.getText(), typed, 'the editor keeps what was typed and only that')
})

/** The component instances of the page by name, walked from the Vue app. */
const MOUNTED = `(() => {
  const n = {}
  const walk = v => {
    if (!v || typeof v !== 'object') return
    if (v.component) {
      const name = v.component.type.__name || v.component.type.name
      if (name) n[name] = (n[name] || 0) + 1
      return walk(v.component.subTree)
    }
    if (v.suspense) walk(v.suspense.activeBranch)
    if (Array.isArray(v.children)) v.children.forEach(walk)
  }
  const app = [...document.querySelectorAll('*')].find(e => e.__vue_app__)?.__vue_app__
  walk(app?._instance?.subTree)
  return n
})()`

test('a 3D pane mounts the 3D view alone: no 2D markup, one tool stack and one assist', { skip }, async () => {
  await page.send('Page.navigate', { url: new URL('board/Quad?ide=1&view=3d', S.dev.url).href })
  await until('the 3D pane', () => ev(`document.documentElement.dataset.ready === '3d'`).catch(() => false), 30000)
  assert.equal(await ev(`document.querySelectorAll('.board-svg').length`), 0, 'no 2D markup in the DOM')
  const n = await ev(MOUNTED)
  assert.equal(n.Canvas3D, 1, 'the 3D view, whose tools3d is the one tool stack and assist')
  assert.equal(n.Canvas2D ?? 0, 0, 'no 2D view, so no second tool stack or assist')
})

/** What the 3D pose draws again now: the count of its items by kind, and how far in x each route copy stands from its own mesh, in mm. */
const POSED = `(() => {
  const k = window.__pcbjs3d, items = k.pcb.board.items
  k.scene.updateMatrixWorld()
  const out = { kinds: {}, dx: [] }
  for (const g of k.pcb.ghosts.children) {
    const it = items.find(i => i.id === g.userData.id)
    out.kinds[it.kind] = (out.kinds[it.kind] || 0) + 1
    if (it.kind !== 'track') continue
    const own = k.pcb.ownOf(it.id)[0]
    const V = own.position.constructor
    out.dx.push(new V().setFromMatrixPosition(g.matrixWorld).x - new V().setFromMatrixPosition(own.matrixWorld).x)
  }
  return out
})()`

test('Blinky in 3D: a drag of the instance CH1 moves its routes and text in the preview, as in 2D', { skip }, async () => {
  const file = join(dirname(quad), 'blinky.pcb.tsx')
  const doc = ed.fake.docs.find(d => d.uri.fsPath === file) ?? (await ed.open(file))
  const text0 = doc.getText()
  await show('Blinky', 'R1')
  await settled('Blinky')
  await key('Escape', 'Escape')
  await click(await screenOf(11.175, 5))
  await until('CH1 selected', async () => (await chip()).startsWith('CH1'))
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '3D').click()`)
  await until('the 3D view', () => ev(`document.documentElement.dataset.ready === '3d'`), 30000)
  const body = await until('R1 in 3D', () => ev(BODY('R1')), 20000)
  await sleep(1000)
  const to = await ev(SCREEN3('R1', body.at[0] + 2, body.at[1]))
  let posed = null
  await gesture(
    'CH1 drag in 3D',
    async () => {
      await mouse('mouseMoved', body.screen)
      await mouse('mousePressed', body.screen)
      for (let i = 1; i <= 8; i++) {
        await mouse('mouseMoved', [body.screen[0] + ((to[0] - body.screen[0]) * i) / 8, body.screen[1] + ((to[1] - body.screen[1]) * i) / 8], { held: true })
        await sleep(16)
      }
      await sleep(100)
      posed = await ev(POSED)
      await mouse('mouseReleased', to)
    },
    { board: 'Blinky', file },
  )
  assert.match(doc.getText(), /<LedChannelRow g=\{CH1\} at="18 5" label="LED1" \/>/)
  assert.ok(posed.kinds.track >= 3, `CH1's three routes drawn again: ${JSON.stringify(posed)}`)
  assert.ok(posed.kinds.text >= 1, `its label drawn again: ${JSON.stringify(posed)}`)
  assert.ok(posed.kinds.pad >= 4, `its parts' pads drawn again: ${JSON.stringify(posed)}`)
  for (const dx of posed.dx) assert.ok(Math.abs(dx - 2) < 0.05, `a route copy moved by ${dx}, not 2: ${JSON.stringify(posed)}`)
  const n = compiles('Blinky')
  doc.type(text0)
  await until('Blinky compiled from its text again', () => compiles('Blinky') > n, 20000)
})

test('a 3D pane loads its entry of @pcbjs/ui alone: no other view, no panels, no whole library', { skip }, async () => {
  // as the extension opens it, the sidebar showing findings, nets and BOM
  await page.send('Page.navigate', { url: new URL('board/Quad?ide=1&view=3d&panel=0', S.dev.url).href })
  await until('the 3D pane', () => ev(`document.documentElement.dataset.ready === '3d'`).catch(() => false), 30000)
  const urls = await ev(`performance.getEntriesByType('resource').map(e => e.name)`)
  const ui = urls.map(u => /@pcbjs_ui(_\w+)?\.js/.exec(new URL(u).pathname)?.[0]).filter(Boolean)
  assert.deepEqual([...new Set(ui)], ['@pcbjs_ui_view3d.js'], `the entries the pane loaded: ${ui.join(', ')}`)
  assert.ok(
    urls.some(u => new URL(u).pathname.endsWith('/src/pane.ts')),
    'the pane page, not the whole app',
  )
  const n = await ev(MOUNTED)
  for (const name of ['Board2D', 'BoardSch', 'RailLeft', 'RailRight', 'BoardPage']) assert.equal(n[name] ?? 0, 0, `no ${name}`)
  assert.equal(n.Pane, 1, 'the pane of the 3D entry')
})

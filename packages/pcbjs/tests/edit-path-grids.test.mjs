// The edit path's grid dots and the drags that never flicker back, in 2D and 3D; the harness is edit-path-harness.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import {
  harness,
  BODY,
  S,
  SAMPLE,
  SCREEN3,
  centre,
  chip,
  click,
  compiles,
  dblclick,
  drag,
  ed,
  ev,
  gesture,
  key,
  quad,
  screenOf,
  settled,
  viewSettled,
  shot,
  show,
  skip,
  sleep,
  until,
} from './edit-path-harness.mjs'

harness()

test('a part under a defineGrid: its grid drawn as dots through its own origin, a drag snapping to them', { skip }, async () => {
  const text = ed.doc
    .getText()
    .replace("import { route, pour, via } from '@pcbjs/core'", "import { defineGrid, route, pour, via } from '@pcbjs/core'")
    .replace('  H = 15\n', "  H = 15\nconst field = defineGrid('field', { pitch: 1, minor: [2] })\n")
    .replace('<g name="Divider" at="16 7.5">', '<g name="Divider" at="16 7.5" grid={field}>')
    .replace(/<R1 at="[^"]*" \/>/, '<R1 at="-5.8 1" />')
  assert.match(text, /grid=\{field\}[\s\S]*<R1 at="-5\.8 1" \/>/)
  const n = compiles()
  ed.type(text)
  await until('Quad compiled with the grid', () => compiles() > n, 20000)
  await settled()
  await key('Escape', 'Escape')
  await key('Escape', 'Escape')
  await until('R1 redrawn at 10.2', async () => {
    const x = await ev(
      `(() => { const e = [...document.querySelectorAll('svg.board-svg g.layer [data-ref="R1"][data-kind="pad"]')].map(e => e.getBBox()); return e.length ? Math.min(...e.map(b => b.x)) : null })()`,
    )
    return x !== null && Math.abs(x - (10.2 - 0.825 - 0.4)) < 0.3
  })
  await dblclick(await screenOf(11.025, 8.5))
  await until('R1 inside Divider', async () => /^Divider\s*\/\s*R1/.test(await chip()))
  await until('the dots of its grid', () => ev(`!!document.querySelector('.grid-dots path.dot')`))
  assert.equal(await ev(`document.querySelector('.bv-edit input[type=checkbox]').checked`), false, 'an off-grid placement starts with snapping disabled')
  await ev(`document.querySelector('.bv-edit input[type=checkbox]').click()`)
  assert.equal(await ev(`document.querySelector('.bv-edit input[type=checkbox]').checked`), true)
  await viewSettled()
  await shot('quad-r1-grid-dots')
  const [from, to] = [await screenOf(11.025, 8.5), await screenOf(12.325, 8.6)]
  await gesture('grid drag', () => drag(from, to))
  assert.match(ed.doc.getText(), /<R1 at="-4\.3 1" \/>/, 'half a pitch at a time from where R1 was, off the grid by as much')
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '3D').click()`)
  await until('the 3D view', () => ev(`!!window.__pcbjs3d && !!document.querySelector('.view3d-host canvas')`), 30000)
  await sleep(4000)
  await shot('quad-r1-grid-dots-3d')
  await show('Quad', 'J1')
})

test('Blinky: a click on R1 selects CH1 with the tools, a drag writes the at of its <LedChannelRow>, the ring its rotation', { skip }, async () => {
  const file = join(dirname(quad), 'blinky.pcb.tsx')
  const doc = await ed.open(file)
  const text0 = doc.getText()
  await show('Blinky', 'R1')
  const on = { board: 'Blinky', file }
  await settled('Blinky')
  await click(await screenOf(11.175, 5))
  await until('CH1 selected', async () => (await chip()).startsWith('CH1'))
  await until('its tools', async () => /Placement/.test(await ev(`document.querySelector('.bv-edit')?.innerText ?? ''`)))
  await shot('blinky-ch1-selected')
  const [from, to] = [await screenOf(11.175, 5), await screenOf(13.175, 5)]
  await ev(SAMPLE('R1'))
  await gesture('CH1 drag', () => drag(from, to), on)
  await until('the samples', async () => (await ev('window.__xs.length')) >= 60, 6000)
  const [x0, xs] = [await ev('window.__x0'), await ev('window.__xs')]
  for (const [i, x] of xs.entries())
    assert.ok(x !== null && Math.abs(x - (x0 + to[0] - from[0])) < 2, `at ${i * 50} ms after the drop R1 is drawn at ${x}, not at ${x0 + to[0] - from[0]}: ${JSON.stringify(xs)}`)
  assert.match(doc.getText(), /<LedChannelRow g=\{CH1\} at="18 5" label="LED1" \/>/)
  assert.equal(doc.getText(), text0.replace('g={CH1} at="16 5"', 'g={CH1} at="18 5"'), 'one attribute changed')
  await until('R1 redrawn', async () => {
    const x = await ev(`(() => { const e = document.querySelector('svg.board-svg g.layer [data-ref="R1"][data-kind="pad"]'); return e && e.getBBox().x })()`)
    return x !== null && x > 12.5
  })
  await sleep(300)
  await shot('blinky-ch1-dragged')
  await settled('Blinky')
  const knob = await centre('[data-tool=ring].knob')
  const c = await screenOf(18, 5)
  const rr = Math.hypot(knob[0] - c[0], knob[1] - c[1])
  await gesture('CH1 ring', () => drag(knob, [c[0], c[1] - rr]), on)
  assert.match(doc.getText(), /<LedChannelRow g=\{CH1\} at="18 5 90" label="LED1" \/>/)
  const n = compiles('Blinky')
  doc.type(text0)
  await until('Blinky compiled from its text again', () => compiles('Blinky') > n, 20000)
  await show('Quad', 'J1')
})

test('Blinky in 3D: CH1 dragged is never drawn back where it was after the drop, the ring at its origin', { skip }, async () => {
  const file = join(dirname(quad), 'blinky.pcb.tsx')
  const doc = ed.fake.docs.find(d => d.uri.fsPath === file) ?? (await ed.open(file))
  const text0 = doc.getText()
  await show('Blinky', 'R1')
  await settled('Blinky')
  // the session keeps CH1 selected from the last test, and a click on R1 then would enter its definition
  await key('Escape', 'Escape')
  await click(await screenOf(11.175, 5))
  await until('CH1 selected', async () => (await chip()).startsWith('CH1'))
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '3D').click()`)
  await until('the 3D view', () => ev(`document.documentElement.dataset.ready === '3d'`), 30000)
  const body = await until('R1 in 3D', () => ev(BODY('R1')), 20000)
  await sleep(1000)
  await shot('blinky-ch1-selected-3d')
  const to = await ev(SCREEN3('R1', body.at[0] + 2, body.at[1]))
  // headless WebGL draws a frame in hundreds of ms: every frame drawn after the drop for 6 s is sampled
  await ev(`(() => {
    window.__xs = []
    window.__done = false
    addEventListener('pointerup', () => {
      const t0 = performance.now()
      const tick = now => {
        try { window.__xs.push((${BODY('R1')})?.at[0] ?? null) } catch (e) { window.__xs.push(String(e)) }
        if (now - t0 < 6000) requestAnimationFrame(tick)
        else window.__done = true
      }
      requestAnimationFrame(tick)
    }, { once: true, capture: true })
  })()`)
  await gesture('CH1 drag in 3D', () => drag(body.screen, to), { board: 'Blinky', file })
  assert.match(doc.getText(), /<LedChannelRow g=\{CH1\} at="18 5" label="LED1" \/>/)
  await until('the frames sampled', () => ev('window.__done'), 15000)
  const xs = await ev('window.__xs')
  assert.ok(xs.length >= 5, `frames drawn: ${xs.length}`)
  for (const [i, x] of xs.entries())
    assert.ok(x !== null && Math.abs(x - (body.at[0] + 2)) < 0.05, `frame ${i} after the drop draws R1 at x ${x}, not ${body.at[0] + 2}: ${JSON.stringify(xs)}`)
  const n = compiles('Blinky')
  doc.type(text0)
  await until('Blinky compiled from its text again', () => compiles('Blinky') > n, 20000)
  await show('Quad', 'J1')
})

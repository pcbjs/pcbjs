import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { arcPoint } from '@pcbjs/core/internal/trace-arc'
import { harness, skip, click, centre, screenOf, ev, ed, page, until, compiles, sleep, shot, quad, viewSettled } from './edit-path-harness.mjs'

harness()

async function change(label, value, expected) {
  const selector = `[aria-label=${JSON.stringify(label)}]`
  await enabled(selector)
  const applied = ed.applied.length,
    compiled = compiles()
  await ev(
    `(() => { const field = document.querySelector('[aria-label=${JSON.stringify(label)}]'); field.value=${JSON.stringify(value)}; field.dispatchEvent(new Event('change', {bubbles:true})); })()`,
  )
  await until(`${label} source edit`, () => ed.applied.length === applied + 1 && expected.test(ed.doc.getText()))
  await until(`${label} compile`, () => compiles() > compiled)
  await sleep(400)
  await enabled(selector)
}

const enabled = selector => until(`${selector} enabled`, () => ev(`document.querySelector(${JSON.stringify(selector)})?.disabled === false`))

async function primitive(value) {
  await until(`primitive ${value} compiled`, () => ev(`document.querySelector('[aria-label="Trace primitive"]')?.value === ${JSON.stringify(value)}`))
  await enabled('.bv-edit input[type=checkbox]')
}

test('trace toolbar selects its primitive, converts coordinates and changes its actual copper layer', { skip }, async () => {
  await click(await screenOf(5, 6.23))
  await primitive('H')
  await until('source primitive selected', () => ed.selects.length > 0)
  const source = ed.selects.at(-1)
  const range = source.items.find(item => item.uri === source.primary.uri).ranges[source.primary.index]
  const line = ed.doc.getText().split('\n')[range.start.line]
  assert.match(line.slice(range.start.character, range.end.character), /\.H\(7\.905\)/)
  await click(await centre('.bv-edit input[type=checkbox]'))
  await until('relative coordinates written', () => /\.h\(4\.905\)/.test(ed.doc.getText()))
  await primitive('h')
  await until('relative checkbox reflects compile', () => ev(`document.querySelector('.bv-edit input[type=checkbox]')?.checked === true`))
  await click(await centre('.bv-edit input[type=checkbox]'))
  await until('absolute coordinates restored', () => /\.H\(7\.905\)/.test(ed.doc.getText()))
  await primitive('H')
  await until('absolute checkbox restored', () => ev(`document.querySelector('.bv-edit input[type=checkbox]')?.checked === false`))
  assert.equal(await ev(`document.querySelector('[aria-label="Previous trace segment"]').disabled`), true)
  await click(await centre('[aria-label="Next trace segment"]'))
  await until('next segment selected', () => ev(`document.querySelector('[aria-label="Trace primitive"]')?.value === 'L'`))
  assert.equal(await ev(`document.querySelector('[aria-label="Next trace segment"]').disabled`), true)
  await click(await centre('[aria-label="Previous trace segment"]'))
  await until('previous segment selected', () => ev(`document.querySelector('[aria-label="Trace primitive"]')?.value === 'H'`))
  await click(await screenOf(5, 6.23))
  await until('midpoint inserted in focused segment', () => /\.L\('5 6\.23'\)\.H\(7\.905\)/.test(ed.doc.getText()))
  await until('remaining segment focused after insertion', () =>
    ev(`document.querySelector('[aria-label="Trace primitive"]')?.value === 'H' && document.querySelector('[aria-label="Previous trace segment"]')?.disabled === false`),
  )
  await click(await centre('[aria-label="Previous trace segment"]'))
  await until('inserted segment selected', () => ev(`document.querySelector('[aria-label="Trace primitive"]')?.value === 'L'`))
  await click(await centre('[aria-label="Delete trace segment"]'))
  await until('inserted segment deleted', () => !/\.L\('5 6\.23'\)/.test(ed.doc.getText()))
  await sleep(600)
  await change('Trace layer', 'B.Cu', /\.layer\("B.Cu"\)/)
  await until('trace layer reflects compile', () => ev(`document.querySelector('[aria-label="Trace layer"]')?.value === 'B.Cu'`))
  await shot('trace-focus-toolbar')
})

test('placement toolbar edits local coordinates, side and grid, and resets a zoomed view', { skip }, async () => {
  await ed.link.request('session/select', { board: 'Quad', refs: ['Divider'], anchor: 'Divider' })
  await until('placement toolbar', () => ev(`!!document.querySelector('[aria-label="Placement X"]')`))
  await change('Placement X', '17mm', /<g name="Divider" at="17 7\.5"/)
  await change('Placement rotation', '90deg', /<g name="Divider" at="17 7\.5 90"/)
  await change('Placement side', 'B', /<g name="Divider" at="17 7\.5 90" side="B"/)
  await change('Editing grid', '0.25', /grid=\{\{ snap: 0\.25 \}\}/)
  assert.equal(await ev(`document.querySelector('[aria-label="Editing grid"]').value`), '0.25')
  assert.equal(await ev(`document.querySelector('.bv-edit input[type=checkbox]').checked`), true)
  await change('Editing grid', '2.54', /snap: 2\.54/)
  await until('off-grid snap unchecked', () => ev(`document.querySelector('.bv-edit input[type=checkbox]').checked === false`))
  await change('Editing grid', '1', /snap: 1 /)
  await until('half-grid snap checked', () => ev(`document.querySelector('.bv-edit input[type=checkbox]').checked === true`))
  assert.match(ed.doc.getText(), /<g name="Divider" at="17 7\.5 90" side="B" grid=\{\{ snap: 1 \}\}/)
  await ev('window.__beforeGridReload = true')
  await page.send('Page.reload')
  await until('persisted grid after preview reload', () =>
    ev(
      `!window.__beforeGridReload && document.querySelector('[aria-label="Editing grid"]')?.value === '1' && document.querySelector('.bv-edit input[type=checkbox]')?.checked === true`,
    ).catch(() => false),
  )
  await viewSettled()
  const snap = '.bv-edit input[type=checkbox]'
  const before = await ev(`document.querySelector(${JSON.stringify(snap)}).checked`)
  await click(await centre(snap))
  assert.equal(await ev(`document.querySelector(${JSON.stringify(snap)}).checked`), !before)
  await click(await centre('[aria-label="Reset view"]'))
  await viewSettled()
  const fitted = await ev(`document.querySelector('svg.board-svg').getAttribute('viewBox')`)
  await ev(
    `(() => {const e=document.querySelector('svg.board-svg'),r=e.getBoundingClientRect();e.dispatchEvent(new WheelEvent('wheel',{clientX:r.x+r.width/2,clientY:r.y+r.height/2,deltaY:-300,bubbles:true,cancelable:true}));})()`,
  )
  await until('zoom changed', async () => (await ev(`document.querySelector('svg.board-svg').getAttribute('viewBox')`)) !== fitted)
  await viewSettled()
  await click(await centre('[aria-label="Reset view"]'))
  await until('reset fitted frame', async () => (await ev(`document.querySelector('svg.board-svg').getAttribute('viewBox')`)) === fitted)
  await shot('placement-focus-toolbar')
})

test('clicking the curved interior of a focused arc splits it into arcs with fixed final endpoint and sweep', { skip }, async () => {
  const text = readFileSync(quad, 'utf8').replace('.H(7.905).L(9.175, 7.5)', '.A(9.175, 7.5, 90)')
  assert.match(text, /\.A\(9\.175, 7\.5, 90\)/)
  const before = compiles()
  ed.type(text)
  await until('arc source compiled', () => compiles() > before)
  await ed.link.request('session/select', { board: 'Quad', refs: ['route:1/pt:1'], anchor: 'route:1/pt:1' })
  await until('arc primitive selected', () => ev(`document.querySelector('[aria-label="Trace primitive"]')?.value === 'A'`))
  const snap = '.bv-edit label[title="Snap to the editing grid"] input'
  if (await ev(`document.querySelector(${JSON.stringify(snap)}).checked`)) await click(await centre(snap))
  const midpoint = arcPoint([3, 6.23], [9.175, 7.5], 90, 0.5)
  assert.ok(midpoint)
  await click(await screenOf(...midpoint))
  await until('arc split source', () => /\.A\([^)]*\)\.A\(/.test(ed.doc.getText()))
  await until('arc split compiled', () => compiles() > before + 1)
  const { facets } = await ed.link.request('session/facets', { entry: 'quad.pcb.tsx', facets: ['meta'] })
  const arcs = facets[0].data.edit.find(node => node.ref === 'route:1').steps.filter(step => step.op === 'A')
  assert.equal(arcs.length, 2)
  assert.ok(Math.abs(arcs.reduce((sum, arc) => sum + arc.angle, 0) - 90) < 1e-6)
  const route = await ed.link.request('session/q', { board: 'Quad', reference: 'route:1' })
  assert.deepEqual(route.value.record.points.at(-1).at, [9.175, 7.5])
  await shot('arc-focus-toolbar')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, skip, click, centre, ev, ed, until, sleep } from './edit-path-harness.mjs'

harness()

test('empty-canvas blur exits instance layout and restores the previous view without Escape', { skip }, async () => {
  const viewBox = () => ev(`document.querySelector('svg.board-svg').getAttribute('viewBox')`)
  const before = await viewBox()
  await ed.link.request('session/select', { board: 'Quad', refs: ['Divider'], anchor: 'Divider' })
  await until('instance action', () => ev(`!!document.querySelector('[aria-label="Edit instance layout"]')`))
  await click(await centre('[aria-label="Edit instance layout"]'))
  await until('instance mode', () => ev(`document.querySelector('[aria-label="Edit instance layout"]')?.disabled === true`))
  await ed.link.request('session/select', { board: 'Quad', refs: ['R1'], anchor: 'R1' })
  await until('part focused inside instance', () => ev(`!!document.querySelector('[aria-label="Placement X"]') && !!document.querySelector('.layout-state')`))
  await sleep(450)
  const written = ed.applied.length
  await click(await ev(`(() => { const r=document.querySelector('svg.board-svg').getBoundingClientRect(); return [r.right-18,r.bottom-18] })()`))
  await until('instance context dismissed', () => ev(`!document.querySelector('.layout-state') && !document.querySelector('[aria-label="Placement X"]')`))
  await until('view restored', async () => (await viewBox()) === before)
  assert.equal(ed.applied.length, written, 'blur changes view state only')
})

// Shared library editing through 2D and 3D, with source writes and all instance placements checked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  harness,
  S,
  WATCH_WRITTEN,
  chip,
  centre,
  click,
  compiles,
  drag,
  ed,
  ev,
  gesture,
  key,
  page,
  quad,
  screenOf,
  settled,
  shot,
  show,
  skip,
  sleep,
  until,
} from './edit-path-harness.mjs'

harness()

/** The page on a board with a query, 3D waiting for its ready mark, the chip's confirmations watched again. */
async function open(board, query, view) {
  await ev('window.__beforeReload = true')
  await page.send('Page.navigate', { url: new URL(`board/${board}?view=${view}&${query}`, S.dev.url).href })
  await until(`the ${view} view of ${board}`, () => ev(`!window.__beforeReload && document.documentElement?.dataset.ready === ${JSON.stringify(view)}`).catch(() => false), 30000)
  await ev(WATCH_WRITTEN)
  await sleep(view === '3d' ? 1500 : 500)
}

test('library editing isolates the template, edits its source and updates every board instance', { skip }, async () => {
  const layout = join(dirname(quad), 'lib', 'led-channel.tsx')
  const board = join(dirname(quad), 'blinky.pcb.tsx')
  const doc = await ed.open(layout)
  const original = doc.getText()
  const disk = readFileSync(board, 'utf8')
  await show('Blinky', 'R1')
  await settled('Blinky')
  await click(await screenOf(11.175, 5))
  await until('CH1 selected', async () => (await chip()).startsWith('CH1'))
  await click(await centre('[aria-label="Edit library layout"]'))
  await until('library template', () =>
    ev(
      `document.querySelector('.layout-state')?.textContent.includes('Library layout') && !document.querySelector('.selection-status[role="status"]') && !!document.querySelector('svg.board-svg [data-ref="R1"]') && !document.querySelector('svg.board-svg [data-ref="R2"]')`,
    ),
  )
  const pad = 'svg.board-svg [data-ref="R1"][data-kind="pad"]'
  await click(await centre(pad))
  await until('local resistor selected', () => ev(`document.querySelector('.chip.path .seg')?.textContent.trim() === 'R0'`))
  await until('placement tools', () => ev(`!!document.querySelector('[aria-label="Placement X"]')`))
  const from = await centre(pad)
  const a = await screenOf(0, 0),
    b = await screenOf(1, 0)
  const edit = await gesture('library resistor drag', () => drag(from, [from[0] + b[0] - a[0], from[1] + b[1] - a[1]]), { board: 'Blinky', file: layout })
  assert.deepEqual(
    edit.documentChanges.map(c => c.textDocument.uri),
    [pathToFileURL(layout).href],
  )
  assert.equal(doc.getText(), original.replace('<g.R at="-4mm 0" />', '<g.R at="-3mm 0" />'))
  assert.equal(readFileSync(board, 'utf8'), disk, 'no instance override added')
  await open('Blinky', 'isolate=CH1&isolate-mode=library&select=R1', '3d')
  await until('3D library uses local numbering', () => ev(`document.querySelector('.chip.path .seg')?.textContent.trim() === 'R0'`))
  await key('Escape', 'Escape')
  await until('library closed', () => ev(`!document.querySelector('.layout-state')`))
  await show('Blinky', 'R1')
  for (const ref of ['R1', 'R2', 'R3']) {
    const x = await ev(`document.querySelector('svg.board-svg [data-ref="${ref}"][data-kind="pad"]').getBBox().x`)
    assert.ok(x > 11.2, `${ref} follows the shared layout: ${x}`)
  }
  const n = compiles('Blinky')
  doc.type(original)
  await until('layout restored', () => compiles('Blinky') > n, 20000)
})

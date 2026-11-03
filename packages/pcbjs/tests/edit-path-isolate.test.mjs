// The edit path inside an isolation: a second click on R1 in Blinky enters LedChannelRow's definition with CH1's values, a drag of R writes
// <g.R at> in the layout through the editor, never an own placement, and the three channels follow; PCBJS_E2E_SHOTS keeps the 2D and 3D
// shots before and after, and of the board after leaving. The harness is edit-path-harness.mjs.
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
  await page.send('Page.navigate', { url: new URL(`board/${board}?view=${view}&${query}`, S.dev.url).href })
  await until(`the ${view} view of ${board}`, () => ev(`document.documentElement.dataset.ready === ${JSON.stringify(view)}`).catch(() => false), 30000)
  await ev(WATCH_WRITTEN)
  await sleep(view === '3d' ? 1500 : 500)
}

test(
  'Blinky isolation: a second click on R1 enters LedChannelRow with CH1’s values, a drag of R writes <g.R at> in the layout and the three channels follow',
  { skip },
  async () => {
    const root = dirname(quad)
    const layout = join(root, 'lib', 'led-channel.tsx'),
      board = join(root, 'blinky.pcb.tsx')
    const ldoc = await ed.open(layout)
    const l0 = ldoc.getText()
    const disk = readFileSync(board, 'utf8')
    await show('Blinky', 'R1')
    await settled('Blinky')
    await click(await screenOf(11.175, 5))
    await until('CH1 selected', async () => (await chip()).startsWith('CH1'))
    await click(await screenOf(11.175, 5))
    await until('layout choice', () => ev(`!!document.querySelector('[aria-label="Choose layout to edit"]')`))
    await click(await centre('[aria-label="Choose layout to edit"] button:nth-of-type(2)'))
    await until('the definition', async () => /LedChannelRow, shown with/.test(await chip()))
    assert.match(await chip(), /CH1\s*\/\s*R[\s\S]*LedChannelRow, shown with[\s\S]*'s values, 3 instances follow/)
    assert.ok(await ev(`document.querySelector('svg.board-svg g.layer [data-ref="R2"]').classList.contains('iso-out')`), 'CH2 is hidden')
    assert.ok(await ev(`[...document.querySelectorAll('svg.board-svg g.layer[data-kind="edge"] [data-id]')].every(e => e.classList.contains('iso-out'))`), 'the outline is hidden')
    await shot('blinky-ch1-isolated-2d')
    await open('Blinky', 'isolate=CH1', '3d')
    await shot('blinky-ch1-isolated-3d')
    await open('Blinky', 'isolate=CH1&select=CH1/R', '2d')
    await until('its tools', async () => /Move/.test(await ev(`document.querySelector('.bv-edit')?.innerText ?? ''`)))
    const [from, to] = [await screenOf(11.175, 5), await screenOf(12.175, 5)]
    const edit = await gesture('isolated R drag', () => drag(from, to), { board: 'Blinky', file: layout })
    assert.deepEqual(Object.keys(edit.changes ?? {}).concat((edit.documentChanges ?? []).map(c => c.textDocument.uri)), [pathToFileURL(layout).href], 'only the layout')
    assert.match(ldoc.getText(), /<g\.R at="-3mm 0" \/>/)
    assert.equal(ldoc.getText(), l0.replace('<g.R at="-4mm 0" />', '<g.R at="-3mm 0" />'), 'one attribute changed')
    assert.equal(readFileSync(board, 'utf8'), disk, 'no own placement in blinky.pcb.tsx')
    await until('R1 redrawn', async () => {
      const x = await ev(`(() => { const e = document.querySelector('svg.board-svg g.layer [data-ref="R1"][data-kind="pad"]'); return e && e.getBBox().x })()`)
      return x !== null && x > 11.2
    })
    await sleep(300)
    await shot('blinky-ch1-isolated-dragged-2d')
    await key('Escape', 'Escape')
    await until('back on the board with CH1 selected', async () => (await chip()).startsWith('CH1') && !/shown with/.test(await chip()))
    for (const r of ['R2', 'R3']) {
      const x = await ev(`(() => { const e = document.querySelector('svg.board-svg g.layer [data-ref="${r}"][data-kind="pad"]'); return e && e.getBBox().x })()`)
      assert.ok(x > 11.2, `${r} followed the definition: ${x}`)
    }
    await sleep(300)
    await shot('blinky-after-isolated-drag-2d')
    await open('Blinky', 'isolate=CH1', '3d')
    await shot('blinky-ch1-isolated-dragged-3d')
    // the session gives the isolation back to a page that loads; Escape leaves it for the board
    await open('Blinky', 'side=F', '3d')
    await key('Escape', 'Escape')
    await until('the 3D board', async () => !/shown with/.test(await chip()))
    await sleep(1500)
    await shot('blinky-after-isolated-drag-3d')
    const n = compiles('Blinky')
    ldoc.type(l0)
    await until('Blinky compiled from the layout again', () => compiles('Blinky') > n, 20000)
    await show('Quad', 'J1')
  },
)

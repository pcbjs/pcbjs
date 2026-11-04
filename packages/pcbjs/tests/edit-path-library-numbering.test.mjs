import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { harness, skip, click, centre, ev, ed, page, S, quad, until, sleep, key } from './edit-path-harness.mjs'

harness()

async function open(query, view = '2d') {
  await ev('window.__beforeReload = true')
  await page.send('Page.navigate', { url: new URL(`board/Blinky?view=${view}&${query}`, S.dev.url).href })
  await until(`${view} library page`, () => ev(`!window.__beforeReload && document.documentElement.dataset.ready === '${view}'`).catch(() => false), 30000)
}

const label = () => ev(`document.querySelector('.chip.path .seg')?.textContent.trim()`)

test('library labels restart for each instance and local selection edits the shared source', { skip }, async () => {
  const file = join(dirname(quad), 'lib', 'led-channel.tsx')
  const doc = await ed.open(file)
  await open('select=CH2')
  await click(await centre('[aria-label="Edit library layout"]'))
  await until('shared geometry loaded', () =>
    ev(
      `!!document.querySelector('svg.board-svg [data-ref="R2"]') && !document.querySelector('.selection-status[role="status"]') && document.querySelector('.layout-state')?.textContent.includes('Library layout')`,
    ),
  )
  const n = ed.selects.length
  await click(
    await ev(
      `(() => { const e = document.querySelector('svg.board-svg [data-ref="R2"][data-kind="pad"]'); const r = e.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] })()`,
    ),
  )
  await sleep(700)
  await until('local R0 selected', async () => (await label()) === 'R0')
  await until('shared source selected', () => ed.selects.length > n && ed.selects.at(-1).primary.uri === pathToFileURL(file).href)
  const selected = ed.selects.at(-1)
  const range = selected.items.find(i => i.uri === selected.primary.uri).ranges[selected.primary.index]
  assert.match(doc.getText().split('\n')[range.start.line], /<g\.R at="-4mm 0"/)
  assert.equal(await ev(`document.querySelector('[aria-label="Placement X"]').value`), '-4mm')
  const written = ed.applied.length
  await ev(`(() => { const e = document.querySelector('[aria-label="Placement X"]'); e.value = '-3mm'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await until('shared layout edited', () => ed.applied.length === written + 1 && doc.getText().includes('<g.R at="-3mm 0"'))
  assert.equal(ed.applied.at(-1).documentChanges[0].textDocument.uri, pathToFileURL(file).href)
  await until('local label survives recompile', async () => (await label()) === 'R0')
  await sleep(500)
  await key('Escape', 'Escape')
  await until('library closed', () => ev(`!document.querySelector('.layout-state')`))
  await ed.link.request('session/select', { board: 'Blinky', refs: ['CH1'], anchor: 'CH1' })
  await until('first instance focused', () => ev(`document.querySelector('.chip.path')?.textContent.includes('CH1')`))
  await click(await centre('[aria-label="Edit library layout"]'))
  await until('first instance library loaded', () => ev(`!!document.querySelector('svg.board-svg [data-ref="R1"]') && !document.querySelector('svg.board-svg [data-ref="R2"]')`))
  await ed.link.request('session/select', { board: 'Blinky', refs: ['R1'], anchor: 'R1', isolate: 'CH1', isolateMode: 'library' })
  await until('first instance also R0', async () => (await label()) === 'R0')
  await open('isolate=CH1&isolate-mode=library&select=R1', '3d')
  await until('3D uses local R0', async () => (await label()) === 'R0')
  await key('Escape', 'Escape')
  await until('ordinary numbering restored', async () => !(await ev(`!!document.querySelector('.layout-state')`)))
  await ed.link.request('session/select', { board: 'Blinky', refs: ['R2'], anchor: 'R2' })
  await until('board instance path restored', () => ev(`document.querySelector('.chip.path')?.textContent.includes('CH2')`))
})

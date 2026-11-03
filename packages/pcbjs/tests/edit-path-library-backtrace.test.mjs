import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { harness, skip, click, ev, ed, page, S, quad, until, sleep, compiles } from './edit-path-harness.mjs'

harness()

async function open(view) {
  await ev('window.__beforeReload = true')
  await page.send('Page.navigate', { url: new URL(`board/Blinky?view=${view}`, S.dev.url).href })
  await until(view, () => ev(`!window.__beforeReload && document.documentElement.dataset.ready === '${view}'`).catch(() => false), 30000)
}

const focus = (file, line, character) => ed.link.lsp.peer.notify('pcbjs/focus', { textDocument: { uri: pathToFileURL(file).href }, position: { line, character } })
const label = () => ev(`document.querySelector('.chip.path .seg')?.textContent.trim()`)

test('source declaration and member carets drive library context; preview R returns to its shared JSX block', { skip }, async () => {
  const file = join(dirname(quad), 'lib', 'led-channel.tsx'), board = join(dirname(quad), 'blinky.pcb.tsx')
  const doc = await ed.open(file), entry = await ed.open(board)
  const lines = doc.getText().split('\n')
  const row = lines.findIndex(l => l.startsWith('export const layout ='))
  const resistor = lines.findIndex(l => l.includes('<g.R at='))
  const diode = lines.findIndex(l => l.includes('<g.D at='))
  const circuitPart = lines.findIndex(l => l.trimStart().startsWith('R: R0603'))
  await open('2d')
  await ed.link.request('session/select', { board: 'Blinky', refs: ['CH2'], anchor: 'CH2' })
  await until('CH2 focused', async () => await label() === 'CH2')
  focus(file, row, 18)
  await sleep(1500)
  await until('declaration enters library', () => ev(`document.querySelector('.layout-state')?.textContent.includes('Library layout') && !!document.querySelector('svg.board-svg [data-ref="R2"]') && !document.querySelector('svg.board-svg [data-ref="R1"]')`))
  for (const character of [9, 17, 23]) {
    focus(file, resistor, character)
    await until(`resistor column ${character} selects local R`, async () => await label() === 'R0')
  }
  focus(file, circuitPart, 4)
  await until('co-located schematic member selects the same resistor', async () => await label() === 'R0')
  focus(file, diode, 9)
  await until('D selected from source', async () => await label() === 'D0')
  await sleep(400)
  const n = ed.selects.length
  await click(await ev(`(() => { const e = document.querySelector('svg.board-svg [data-ref="R2"][data-kind="pad"]'); const r=e.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] })()`))
  await until('R returned to source', () => ed.selects.length > n && ed.selects.at(-1).primary.uri === pathToFileURL(file).href)
  const selected = ed.selects.at(-1)
  const range = selected.items.find(i => i.uri === selected.primary.uri).ranges[selected.primary.index]
  assert.equal(range.start.line, resistor, 'the shared R JSX element is selected')
  const line = doc.getText().split('\n')[range.start.line]
  assert.match(line.slice(range.start.character, range.end.character), /g\.R/)
  const instanceLine = entry.getText().split('\n').findIndex(l => l.includes('<LedChannelRow g={CH3}'))
  focus(board, instanceLine, 25)
  await until('instance source leaves library', () => ev(`!document.querySelector('.layout-state') && !!document.querySelector('svg.board-svg [data-ref="R1"]')`))
  focus(file, resistor, 10)
  await until('member reenters library', async () => await label() === 'R0' && await ev(`!!document.querySelector('.layout-state')`))
  await open('sch')
  await sleep(1200)
  await until('schematic template loaded', () => ev(`document.querySelectorAll('svg.sch-svg .sch-markup [data-kind="symbol"]').length === 2`))
  assert.equal(await ev(`document.querySelectorAll('svg.sch-svg .sch-markup [data-kind="symbol"][data-ref="J1"]').length`), 0)
  assert.equal(await label(), 'R0')
  focus(file, diode, 9)
  await until('schematic follows D caret', async () => await label() === 'D0')
  await until('schematic symbol is highlighted', () => ev(`!!document.querySelector('svg.sch-svg .h-anchor[data-ref=\"D3\"]')`))
  focus(board, instanceLine, 25)
  await until('schematic board restored', () => ev(`!document.querySelector('.layout-state') && document.querySelectorAll('svg.sch-svg .sch-markup [data-kind="symbol"]').length > 2`))
})


test('co-located layout variants keep separate declaration focus and shared source targets', { skip }, async () => {
  const file = join(dirname(quad), 'lib', 'led-channel.tsx'), board = join(dirname(quad), 'blinky.pcb.tsx')
  const doc = ed.fake.docs.find(d => d.uri.fsPath === file), entry = ed.fake.docs.find(d => d.uri.fsPath === board)
  await open('2d')
  const before = compiles('Blinky')
  entry.type(entry.getText().replace('layout as LedChannelRow }', 'layout as LedChannelRow, layoutStack as LedChannelStack }').replace('<LedChannelRow g={CH3}', '<LedChannelStack g={CH3}'))
  await entry.save()
  await until('variant compiled', () => compiles('Blinky') > before)
  const lines = doc.getText().split('\n')
  const stack = lines.findIndex(l => l.startsWith('export const layoutStack'))
  const resistor = lines.findIndex((l, i) => i > stack && l.includes('<g.R at='))
  focus(file, stack, 22)
  await until('stack variant selected', () => ev(`document.querySelector('.layout-state')?.textContent.includes('LedChannelStack') && !!document.querySelector('svg.board-svg [data-ref="R3"]') && !document.querySelector('svg.board-svg [data-ref="R1"]')`))
  focus(file, resistor + 1, 9)
  await until('stack diode selected', async () => await label() === 'D0')
  await sleep(400)
  const n = ed.selects.length
  await click(await ev(`(() => { const e = document.querySelector('svg.board-svg [data-ref="R3"][data-kind="pad"]'); const r=e.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] })()`))
  await until('stack resistor source returned', () => ed.selects.length > n && ed.selects.at(-1).primary.uri === pathToFileURL(file).href)
  const selected = ed.selects.at(-1)
  assert.equal(selected.items.find(i => i.uri === selected.primary.uri).ranges[selected.primary.index].start.line, resistor)
})

test('an anonymous layout method retains declaration focus with its default name', { skip }, async () => {
  const file = join(dirname(quad), 'lib', 'led-channel.tsx')
  const doc = ed.fake.docs.find(d => d.uri.fsPath === file)
  const before = compiles('Blinky')
  doc.type(doc.getText().replace("  'LedChannelStack',\n", ''))
  await doc.save()
  await until('default layout compiled', () => compiles('Blinky') > before)
  const lines = doc.getText().split('\n'), stack = lines.findIndex(l => l.startsWith('export const layoutStack'))
  focus(file, stack, 22)
  await until('default-name method enters library', () => ev(`document.querySelector('.layout-state')?.textContent.includes('ledChannelLayout') && !!document.querySelector('svg.board-svg [data-ref="R3"]') && !document.querySelector('svg.board-svg [data-ref="R1"]')`))
})

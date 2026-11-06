// The edit path's editor jumps, the writes with no editor and the keys a pane passes to VS Code; the harness is edit-path-harness.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  harness,
  REPO,
  S,
  TEXT0,
  VSC,
  chip,
  click,
  compiles,
  confirmations,
  dirs,
  drag,
  ed,
  editor,
  ev,
  instanceJump,
  key,
  page,
  quad,
  screenOf,
  serve,
  settled,
  show,
  skip,
  sleep,
  sockets,
  until,
} from './edit-path-harness.mjs'

harness()

test('with an editor the chip has no jump buttons; an alt-click jumps the editor to the definition of what a click selects, the selection kept', { skip }, async () => {
  await show('Blinky', 'R1')
  await settled('Blinky')
  await click(await screenOf(11.175, 5))
  await until('CH1 selected', async () => (await chip()).startsWith('CH1'))
  assert.equal(
    await ev(`[...document.querySelectorAll('.chips-bar button')].filter(b => /Open (placement|definition)/.test(b.textContent)).length`),
    0,
    'no Open placement or Open definition',
  )
  assert.match(await ev(`document.querySelector('.chips-bar .chip.path').title`), /click: placement, (alt|option)-click: definition/)
  const jump = async (at, file) => {
    const n = ed.selects.length
    await click(at, { modifiers: 1 })
    await until(`the editor at ${file}`, () => ed.selects.length > n)
    const s = ed.selects.at(-1)
    assert.ok(s.primary.uri.endsWith(file), `${s.primary.uri} is ${file}`)
    await sleep(300)
    assert.match(await chip(), /^CH1/, 'the selection stays')
  }
  // with CH1 selected a click on R1 selects CH1/R: its declaration in the circuit; J1's declaration, `const J1 = ...`
  await jump(await screenOf(11.175, 5), 'lib/led-channel.tsx')
  await jump(await screenOf(3, 7.46), 'blinky.sch.tsx')
  await show('Quad', 'J1')
})

test('an instance selected in a project session jumps the editor to its layout expression', { skip }, async () => {
  await instanceJump(ed, dirname(quad))
})

test('with no editor holding the file a drag writes to disk, once', { skip }, async () => {
  ed.type(TEXT0)
  await ed.doc.save()
  await ed.close()
  await settled()
  await key('Escape', 'Escape')
  await click(await screenOf(3, 8.77))
  await until('J1 selected', async () => (await chip()).startsWith('J1'))
  await until('the toolbar says it writes to disk', async () => /write to disk/.test(await ev(`document.querySelector('.bv-edit')?.title ?? ''`)))
  const n = compiles()
  const logged = S.log.text.length
  await drag(await screenOf(3, 8.77), await screenOf(5, 8.77))
  await until('the file on disk', () => !readFileSync(quad, 'utf8').includes('<J1 at="3 6.23" />'))
  assert.match(readFileSync(quad, 'utf8'), /<J1 at="5 6\.23" \/>/)
  await until('a compile', () => compiles() > n, 20000)
  await until('the confirmation', async () => (await confirmations()).includes('Updated'))
  await sleep(600)
  assert.equal(compiles() - n, 1, `one compile\n${S.log.text.slice(logged)}`)
  assert.equal(readFileSync(quad, 'utf8'), TEXT0.replace('<J1 at="3 6.23" />', '<J1 at="5 6.23" />'))
})

test('after a change on disk the session compiles for the views shown, and a drag still moves from where the view shows the part', { skip }, async () => {
  writeFileSync(quad, readFileSync(quad, 'utf8').replace('<J1 at="5 6.23" />', '<J1 at="4 6.23" />'))
  await until('the view redrawn', async () => {
    const r = await ev(`(() => { const e = document.querySelector('svg.board-svg g.layer [data-ref="J1"][data-kind="pad"]'); return e && e.getBBox().x })()`)
    return r !== null && r > 3
  })
  await settled()
  await drag(await screenOf(4, 8.77), await screenOf(6, 8.77))
  await until('the file on disk', () => !readFileSync(quad, 'utf8').includes('<J1 at="4 6.23" />'))
  assert.match(readFileSync(quad, 'utf8'), /<J1 at="6 6\.23" \/>/, 'the edit read the board the view shows, not an older one')
})

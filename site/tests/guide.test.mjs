import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { excerptRange } from '../scripts/source-selection.mjs'
import { guideExamples, fencedExamples } from '../scripts/guide-examples.mjs'
import { guideData } from '../scripts/guide-data.mjs'

const dist = process.env.PCBJS_SITE_DIST ? resolve(process.env.PCBJS_SITE_DIST) : new URL('../.vitepress/dist/', import.meta.url).pathname
const first = join(dist, 'guide/getting-started/index.html')
test('drawing selection falls back to visible part identity', () => {
  const ranges = [
    { ids: [1], uids: ['pad'], refs: ['J1'] },
    { ids: [1], uids: ['pad'], refs: ['J1'] },
    { ids: [2], uids: ['body'], refs: ['C1'] },
  ]
  const width = index => [0, 18, 22][index]
  assert.equal(excerptRange(ranges, [1], [], width), 1)
  assert.equal(excerptRange(ranges, ['unmapped-body'], ['C1'], width), 2)
  assert.equal(excerptRange(ranges, ['unmapped-body'], ['R9'], width), -1)
})

test('Guide has both sections, setup pages, unnumbered lessons and resolving links', { skip: !existsSync(first) }, () => {
  const html = readFileSync(first, 'utf8')
  const nav = html.match(/<nav[^>]*id="VPSidebarNav"[\s\S]*?<\/nav>/)?.[0]
  assert.ok(nav, 'Guide has a native sidebar')
  for (const label of [
    'Getting started',
    'Advanced',
    'Quickstart',
    'Setup with npm',
    'Setup with an agent',
    'Set up VS Code',
    'Build the schematic',
    'Check DRC and ERC',
    'Differential pairs',
  ])
    assert.ok(nav.includes(label), label)
  assert.doesNotMatch(nav, /[1-5]\. (Build|Define|Place|Route|Check)/)
  const links = [...new Set([...nav.matchAll(/href="(\/guide\/[^"#]+)"/g)].map(m => m[1]))]
  assert.ok(links.length >= 22)
  for (const link of links) assert.ok(existsSync(join(dist, link.slice(1) + (link.endsWith('/') ? 'index.html' : '.html'))), link)
  const legacy = readFileSync(join(dist, 'docs/quickstart.html'), 'utf8')
  assert.match(legacy, /guide\/getting-started\/quickstart/)
  const reference = readFileSync(join(dist, 'docs/basics.html'), 'utf8').match(/<nav[^>]*id="VPSidebarNav"[\s\S]*?<\/nav>/)?.[0]
  assert.doesNotMatch(reference, /href="\/docs\/quickstart"/)
})

test('each preview compiles exactly its displayed sources and maps only existing entities', async () => {
  const examples = guideExamples()
  const data = await guideData()
  for (const e of examples) {
    const d = data.boards[e.id]
    assert.ok(d, e.id)
    for (const f of d.files) {
      const code = data.sources[f.source].code
      assert.equal(code, e.files[f.name], `${e.id}/${f.name}: compiled source is displayed verbatim`)
      for (const n of f.focus) assert.ok(n > 0 && n <= code.split('\n').length)
      for (const r of f.ranges) {
        for (const id of r.ids)
          assert.ok(
            d.items.some(i => i.id === id),
            `${e.id}: unknown SVG item ${id}`,
          )
        for (const uid of r.uids)
          assert.ok(
            d.items.some(i => i.uid === uid),
            `${e.id}: unknown UID ${uid}`,
          )
        for (const ref of r.refs) assert.ok(d.declared.includes(ref) || d.placed.includes(ref), `${e.id}: unknown part ${ref}`)
      }
    }
    const active = d.files.find(f => f.name === d.activeFile)
    assert.ok(
      active.ranges.some(r => active.focus.includes(r.start[0])),
      `${e.id}: lesson focus maps to actual geometry`,
    )
  }
  const b = data.boards
  assert.deepEqual(b['blinky-board'].placed, [])
  assert.equal(b['blinky-board'].declared.length, 0)
  assert.equal(b['blinky-board'].counts.tracks, 0)
  assert.deepEqual([...b['blinky-placement'].placed].sort(), ['C1', 'J1', 'Q1'])
  assert.equal(b['blinky-placement'].counts.tracks, 0)
  assert.equal(b['blinky-groups'].placed.length, 9)
  assert.equal(b['blinky-groups'].counts.tracks, 0)
  assert.ok(b['blinky-manual'].counts.tracks > 0)
  assert.notEqual(b['blinky-automatic'].svg['2d'], b['blinky-hybrid'].svg['2d'])
  assert.equal(b['blinky-schematic'].declared.length, 9)
  for (const id of ['blinky-checks', 'quickstart-led']) {
    const { tracks, ...findings } = b[id].counts
    assert.ok(tracks > 0)
    assert.deepEqual(Object.values(findings), [0, 0, 0, 0], `${id}: completed example must stay clean`)
  }
})

test('preview fences reject fragments instead of inventing hidden declarations', () => {
  assert.throws(() => fencedExamples('```tsx {1} preview=bad\n<R1 at="0 0" />\n```', 'test.md'), /complete board module/)
})

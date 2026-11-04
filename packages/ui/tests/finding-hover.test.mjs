import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { compileTemplate } from 'vue/compiler-sfc'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (error) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw error
    }
  },
})
const { dotTitle } = await import('../src/finding-marks.ts')
const { findingTitle } = await import('../src/use/findings.ts')
const detail = 'length-match match group DATA spreads 38.884 mm, full diagnostic explanation'
const finding = { id: 'drc:clearance:test', rule: 'clearance', severity: 'error', message: detail, at: [2, 3], refs: ['R1', 'U2'] }

// Compile the actual finding markup with fixture state, so native titles and hover branches execute through Vue.
async function renderFinding(file, from, to, state) {
  const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const start = text.indexOf(from)
  assert.ok(start >= 0)
  const end = text.indexOf(to, start)
  assert.ok(end > start)
  const { code, errors } = compileTemplate({ source: text.slice(start, end), filename: file, id: 'finding-hover', ssr: true, ssrCssVars: [] })
  assert.deepEqual(errors, [])
  const module = code.replace(/from (["'])([^"']+)\1/g, (_, quote, spec) => `from ${JSON.stringify(import.meta.resolve(spec))}`)
  const { ssrRender } = await import(`data:text/javascript;base64,${Buffer.from(module).toString('base64')}`)
  return renderToString(createSSRApp({ setup: () => state, ssrRender }))
}

test('finding hover formatters expose the rule and retain no diagnostic message', () => {
  assert.equal(dotTitle(finding), 'clearance')
  assert.equal(findingTitle(finding), 'clearance')
})

test('2D finding lines render concise native titles while retaining the finding model', async () => {
  const html = await renderFinding('Canvas2D.vue', '<g v-if="findLines.length"', '<g v-if="dots.length"', {
    findLines: [{ from: [0, 0], to: [2, 3], findings: [finding, finding] }],
    ratsVars: {},
    lineClass: () => [],
    shown: new Set([0]),
    px: 1,
    labelAt: () => '',
    labelRow: () => ({ broken: false, start: 0, icon: 0, text: 'clearance' }),
    dotTitle,
  })
  assert.match(html, /<title>clearance<\/title>/)
  assert.doesNotMatch(html, /length-match match group|full diagnostic|clearance\nclearance/)
  assert.equal(finding.message, detail)
})

test('3D hovered line labels show the rule instead of expanding to the full message', async () => {
  const n = { ...finding, key: 'one', check: 'DRC', text: 'R1', line: 0, broken: false }
  for (const noteHover of [null, 'one']) {
    const html = await renderFinding('Canvas3D.vue', '<div v-if="visibleNotes.length"', '<Bubble v-if="dotTip', {
      visibleNotes: [n],
      isStale: () => false,
      finding: n.id,
      noteHover,
      dotTitle,
    })
    assert.match(html, /title="clearance"/)
    assert.doesNotMatch(html, /length-match match group|full diagnostic/)
    assert.match(html, noteHover ? />clearance<\/span>/ : />R1<\/span>/)
  }
})

test('schematic finding markers render only the rule in native hover titles', async () => {
  const html = await renderFinding('CanvasSch.vue', '<g v-if="!hidden.has(\'findings\')"', '<circle v-if="pulse"', {
    hidden: new Set(),
    findings: [finding],
    px: 1,
    dotTitle,
  })
  assert.match(html, /<title>clearance<\/title>/)
  assert.doesNotMatch(html, /length-match match group|full diagnostic/)
})

test('assist overlays reduce diagnostics and router errors to concise finding types', async () => {
  const { fixture } = await import('./fixture-board.mjs')
  const { createViewer } = await import('../src/shell.ts')
  const { useAssist2d } = await import('../src/assist2d.ts')
  const { facetSet } = await import('@pcbjs/core/site-facets')
  const { nextTick } = await import('vue')
  const b = fixture()
  b.dev = { snapshot: 'finding-hover' }
  const store = createViewer({ boards: [facetSet(b)], single: true, path: '/', baseUrl: '/' }).board(b.name)
  store.edit.mode = { mode: 'rw', editor: true }
  store.edit.assist = {
    board: b.name,
    command: 'H',
    relative: false,
    ref: 'route:1',
    start: [10, 7],
    pad: null,
    layer: 'F.Cu',
    net: 'S1',
    side: 'F',
    grid: null,
    width: 0.2,
    typed: [],
    open: true,
  }
  store.edit.client = {
    begin: async () => ({ txn: 'concise', tools: [] }),
    update: async () => ({ files: [], notes: [], preview: { command: 'H', tracks: [], vias: [], findings: [`clearance: ${detail}`, detail], error: detail, ms: 0 } }),
    cancel: async () => null,
  }
  const assist = useAssist2d({ board: () => b, px: () => 0.05, store })
  assist.move({ shiftKey: false }, [13, 7])
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(assist.chip.value.includes('clearance'))
  assert.ok(assist.chip.value.includes('length-match'))
  assert.ok(assist.chip.value.includes('route-failed'))
  assert.ok(!assist.chip.value.join(' ').includes(detail))
  assist.leaveMode()
})

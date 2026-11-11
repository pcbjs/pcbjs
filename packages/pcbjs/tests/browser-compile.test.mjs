// The browser compile in Node: serveCompile behind a fake worker on a memory platform, its facets in stage order, the self-check and expect.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { compileInBrowser, serveCompile, facetKey, mathKind } from '@pcbjs/compile/browser'
import { installNodeMath } from '@pcbjs/compile/internal/fdlibm'
import { boardHash, selfCheck, SELF_CHECK_HASH } from '@pcbjs/compile/internal/self-check'
import { compileStages } from '@pcbjs/compile'
import { clearRouteCache } from '@pcbjs/compile/internal/route-cache'
import { clearStageCache } from '@pcbjs/compile/internal/cache'
import { facetStream } from '@pcbjs/export/internal/facet-stream'
import { platform, setPlatform } from '@pcbjs/core/platform'
import { resetDefaults } from '@pcbjs/core'

const FIXTURE = pathToFileURL(join(import.meta.dirname, 'fixtures', 'browser-board.mjs')).href
const PROJECT = p => pathToFileURL(join(import.meta.dirname, 'fixtures', `browser-project-${p}.mjs`)).href
const STEP = new TextEncoder().encode('ISO-10303-21;')

/** A worker and the page's handle on it, joined by cloned messages on later turns, as postMessage does. */
function fakeWorker(files) {
  const page = { onmessage: null, postMessage: m => setTimeout(() => worker.onmessage?.({ data: structuredClone(m) })), terminate() {} }
  const worker = { onmessage: null, postMessage: m => setTimeout(() => page.onmessage?.({ data: structuredClone(m) })) }
  serveCompile(worker, {
    stream: facetStream,
    fetch: async url => {
      if (!(url in files)) throw new Error(`no ${url}`)
      return files[url]
    },
    load: url => import(url),
  })
  return page
}

const module = (o = {}) => ({
  format: 1,
  root: '/project',
  entry: 'board.mjs',
  module: FIXTURE,
  sources: { '/project/board.mjs': 'x' },
  files: { '/project/models/pad.step': 'step:pad' },
  ...o,
})
const files = { [FIXTURE]: new TextEncoder().encode('export default 1'), 'step:pad': STEP }

function fresh() {
  setPlatform(null)
  resetDefaults()
  clearRouteCache()
  clearStageCache()
}

const MATH = ['sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'exp', 'expm1', 'log', 'log10', 'cosh', 'tanh']

for (const kind of ['plain', 'fused'])
  test(`browser compile: the self-check compiles its fixture to the hash of a Node whose Math is ${kind}`, () => {
    fresh()
    const own = Object.fromEntries(MATH.map(f => [f, Math[f]]))
    if (mathKind() !== kind) installNodeMath(kind)
    try {
      const c = selfCheck(kind)
      assert.equal(c.hash, SELF_CHECK_HASH[kind], `the self-check fixture now hashes ${c.hash}: set SELF_CHECK_HASH.${kind} in packages/compile/src/self-check.ts`)
      assert.equal(c.ok, true)
    } finally {
      Object.assign(Math, own)
    }
  })

test('browser compile: a fake worker streams every facet in stage order and the board Node compiles', async () => {
  fresh()
  const worker = (() => {
    const w = fakeWorker(files)
    return () => w
  })()
  const stages = []
  try {
    const r = await compileInBrowser(module(), { worker, boards: true, stage: s => stages.push(`${s.name}:${s.state}`) })
    assert.equal(r.check.ok, true)
    assert.deepEqual(
      r.facets.map(f => `${f.facet}@${f.stage}`),
      [
        'meta@manual',
        'layers@manual',
        'shapes@manual',
        'meta@place',
        'model@place',
        'sch@schematic',
        'layers@manualCopper',
        'shapes@manualCopper',
        'layers@tune',
        'shapes@tune',
        'layers@finish',
        'shapes@finish',
        'findings@checks',
      ],
    )
    assert.ok(stages.indexOf('manual:done') < stages.indexOf('place:running'))
    assert.ok(stages.indexOf('place:done') < stages.indexOf('checks:done'))
    assert.equal(r.boards.length, 1)
    const board = JSON.parse(r.boards[0].json)
    // the model file exists on the memory platform, so no model-missing, and its mesh is keyed by its bytes
    assert.deepEqual(
      board.erc.filter(m => m.rule === 'model-missing'),
      [],
    )
    const model = r.facets.find(f => f.facet === 'model').data.models.find(m => m.ref === 'J1')
    assert.equal(model.step.file, 'models/pad.step')
    assert.match(model.step.mesh, /^[0-9a-f]{64}$/)
    assert.equal(board.unconnected, 0)
    // the same copper and DRC as Node's own compile of the module, where the model file is missing
    setPlatform(null)
    resetDefaults()
    clearRouteCache()
    const [node] = compileStages((await import(FIXTURE)).default)
    const copper = b => boardHash({ ...b, erc: [] })
    assert.equal(copper(board), copper(JSON.parse(JSON.stringify(node.board))))
  } finally {
    setPlatform(null)
  }
})

test('browser compile: a missing model file warns, a facet unlike expect is a mismatch, a bad module an error', async () => {
  fresh()
  const w = fakeWorker(files)
  const worker = () => w
  const warn = console.warn
  const warned = []
  console.warn = m => warned.push(String(m))
  try {
    const r = await compileInBrowser(module({ files: {}, expect: { [facetKey('Fake', undefined, 'meta')]: '0000' } }), { worker, boards: true })
    assert.deepEqual(r.mismatch, ['Fake//meta'])
    assert.ok(warned.some(m => m.includes('differs from Node')))
    const board = JSON.parse(r.boards[0].json)
    assert.deepEqual(
      board.erc.filter(m => m.rule === 'model-missing').map(m => m.refs),
      [['J1']],
    )
    await assert.rejects(compileInBrowser(module({ module: 'nowhere:x' }), { worker }), /nowhere/)
    assert.equal(platform().name, 'browser')
  } finally {
    console.warn = warn
    setPlatform(null)
  }
})

test('browser compile: one worker compiles boards of two projects, each with its own bound routes', async () => {
  fresh()
  const of = p => ({ format: 1, root: '/project', entry: 'pcb.mjs', module: PROJECT(p), sources: { '/project/pcb.mjs': p }, files: {} })
  const w = fakeWorker({ [PROJECT('a')]: new TextEncoder().encode('export default 1'), [PROJECT('b')]: new TextEncoder().encode('export default 1') })
  const worker = () => w
  try {
    for (const p of ['a', 'b', 'a', 'b']) {
      const r = await compileInBrowser(of(p), { worker, boards: true })
      const board = JSON.parse(r.boards[0].json)
      assert.equal(board.name, p === 'a' ? 'Alpha' : 'Beta')
      assert.deepEqual([...new Set(board.items.filter(i => i.kind === 'track').map(i => i.route))].sort(), p === 'a' ? ['route:2', 'route:trunk'] : ['route:1', 'route:2'])
    }
  } finally {
    setPlatform(null)
  }
})

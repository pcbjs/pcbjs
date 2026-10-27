// The STEP model cache and the dev endpoint: one conversion per content into .pcbjs/models/<hash>.bin, shared by concurrent
// requests, refused when the file changed, and served at /__pcbjs/model/<hash> for the files the compiled boards use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { meshFor, modelBoxLoader, modelMiddleware, modelsDir, usedModels } from '../dist/models.js'
import { meshKey, meshFromBinary } from '@pcbjs/step'

const PIN = new URL('../../step/tests/fixtures/pin.step', import.meta.url).pathname

function project() {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-models-'))
  const file = join(root, 'pin.step')
  copyFileSync(PIN, file)
  return { root, file, hash: meshKey(new Uint8Array(readFileSync(file))), done: () => rmSync(root, { recursive: true, force: true }) }
}

/** One compiled board with a footprint J1 whose STEP model is `file` with mesh `hash`. */
const compiled = (file, hash) => ({
  board: { footprints: [{ ref: 'J1', model: { kind: 'step', step: './pin.step', path: file } }, { ref: 'R1', model: { kind: 'box', w: 1, h: 1, height: 1 } }] },
  site: { footprints: [{ ref: 'J1', step: { file: 'pin.step', mesh: hash, transform: {} } }, { ref: 'R1' }] },
})

test('a STEP file converts once into the cache under its hash, and concurrent requests share the conversion', async () => {
  const p = project()
  try {
    const dir = modelsDir(p.root)
    const [a, b] = await Promise.all([meshFor(p.hash, p.file, dir), meshFor(p.hash, p.file, dir)])
    assert.equal(a, b)
    assert.deepEqual(readdirSync(dir), [`${p.hash}.bin`])
    assert.ok(meshFromBinary(a).meshes.length >= 1)
    // from the cache now: the source is not read again
    rmSync(p.file)
    const c = await meshFor(p.hash, p.file, dir)
    assert.deepEqual(Buffer.from(c), Buffer.from(a))
  } finally { p.done() }
})

test('a file whose content changed since the compile is refused, and nothing is cached', async () => {
  const p = project()
  try {
    writeFileSync(p.file, readFileSync(p.file, 'utf8').replace('0.8,0.6,0.2', '0.2,0.6,0.8'))
    await assert.rejects(meshFor(p.hash, p.file, modelsDir(p.root)), /changed since the board compiled/)
    assert.throws(() => readdirSync(modelsDir(p.root)))
    await assert.rejects(meshFor('nothex', p.file, modelsDir(p.root)), /not a mesh hash/)
  } finally { p.done() }
})

test('the used models are the STEP footprints with a mesh', () => {
  const m = usedModels([compiled('/x/pin.step', 'a'.repeat(64))])
  assert.deepEqual([...m], [['a'.repeat(64), '/x/pin.step']])
  assert.equal(usedModels([{ board: { footprints: [{ ref: 'J1', model: { kind: 'step', step: 'x', path: '/x' } }] }, site: { footprints: [{ ref: 'J1', step: { file: 'x', transform: {} } }] } }]).size, 0)
})

/** Call the middleware like Connect does; resolves with the status, the headers and the body, or 'next'. */
function call(mw, url) {
  return new Promise(resolve => {
    const headers = {}
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v }, end: body => resolve({ status: res.statusCode, headers, body }) }
    mw({ url }, res, () => resolve('next'))
  })
}

test('the dev endpoint serves the mesh of a used model, 404 for any other hash, and leaves other paths alone', async () => {
  const p = project()
  try {
    const state = { slots: [{ compiled: [compiled(p.file, p.hash)] }] }
    const mw = modelMiddleware({ root: p.root }, state)
    const r = await call(mw, `/__pcbjs/model/${p.hash}`)
    assert.equal(r.status, 200)
    assert.equal(r.headers['content-type'], 'application/octet-stream')
    assert.ok(meshFromBinary(r.body).meshes[0].indices.length > 0)
    assert.equal((await call(mw, `/__pcbjs/model/${'0'.repeat(64)}`)).status, 404)
    assert.equal((await call(mw, '/__pcbjs/model/../../etc/passwd')).status, 404)
    assert.equal(await call(mw, '/__pcbjs/boards/x/board.json'), 'next')
    assert.deepEqual(readdirSync(modelsDir(p.root)), [`${p.hash}.bin`])
  } finally { p.done() }
})

test('two processes converting the same file at once leave one complete cache file and no temporary ones', async () => {
  const p = project()
  try {
    const { spawn } = await import('node:child_process')
    const url = new URL('../dist/models.js', import.meta.url).href
    const script = `import { meshFor } from ${JSON.stringify(url)}; const b = await meshFor(process.argv[1], process.argv[2], process.argv[3]); process.stdout.write(String(b.byteLength))`
    const run = () => new Promise((resolve, reject) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', script, p.hash, p.file, modelsDir(p.root)], { stdio: ['ignore', 'pipe', 'inherit'] })
      let out = ''
      c.stdout.on('data', d => { out += d })
      c.on('exit', code => (code === 0 ? resolve(Number(out)) : reject(new Error(`exit ${code}`))))
    })
    const [a, b] = await Promise.all([run(), run()])
    assert.equal(a, b)
    assert.deepEqual(readdirSync(modelsDir(p.root)), [`${p.hash}.bin`])
    assert.equal(readFileSync(join(modelsDir(p.root), `${p.hash}.bin`)).byteLength, a)
  } finally { p.done() }
})

test('after a compile, a model file entry gets its mesh box, the courtyard and the issue when it sits off the courtyard', async () => {
  const p = project()
  try {
    const { compileBoard } = await import('@pcbjs/compile')
    const { siteData } = await import('@pcbjs/export/site-data')
    const { h, PCB } = await import('@pcbjs/core').then(m => ({ h: m.h, PCB: m.default }))
    const { placeModels } = await import('../dist/models.js')
    const fp = (ref, at, offset) => h('footprint', { ref, at, model: { file: p.file, offset } },
      h('pad', { num: 1, size: 2, at: '0 0' }), h('rect', { layer: 'F.CrtYd', x: -1.5, y: -1.5, w: 3, h: 3, width: 0.05 }))
    const board = compileBoard(h(PCB, { name: 'M' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }), fp('J1', '5 5', [0, 0, 0]), fp('J2', '15 5', [3, 0, 0])))
    const site = siteData(board, { root: p.root, fabUrl: '', fabName: '', fabFiles: [], fabStatus: '', svgUrl: '', dev: false, bom: [] })
    await placeModels([{ board, site }], p.root)
    const [j1, j2] = site.footprints.map(f => f.step)
    assert.deepEqual(j1.courtyard, { x0: -1.5, y0: -1.5, x1: 1.5, y1: 1.5 })
    assert.deepEqual(j1.bounds.max.map(v => Math.round(v)), [1, 1, 5])
    assert.equal(j1.issue, undefined)
    assert.match(j2.issue, /model box reaches 2\.5 mm past the courtyard at \+x/)
  } finally { p.done() }
})

test('the model box loader converts a new file in a child process at once, then reads the cache, its transform applied', () => {
  const p = project()
  try {
    // forget the boxes earlier tests of this process read, so the loader goes to the child
    globalThis[Symbol.for('pcbjs.cli.models.bounds')]?.clear()
    const load = modelBoxLoader(p.root)
    const a = load({ kind: 'step', step: './pin.step', path: p.file })
    assert.ok(a && a.max[2] > 0, JSON.stringify(a))
    assert.deepEqual(readdirSync(modelsDir(p.root)), [`${p.hash}.bin`], 'the child wrote the cache')
    // the KiCad transform: an offset raises the top, a scale stretches it
    const up = load({ kind: 'step', step: './pin.step', path: p.file, offset: [0, 0, 2] })
    assert.ok(Math.abs(up.max[2] - a.max[2] - 2) < 1e-9)
    const tall = load({ kind: 'step', step: './pin.step', path: p.file, scale: [1, 1, 2] })
    assert.ok(Math.abs(tall.max[2] - 2 * a.max[2]) < 1e-6)
    // a missing file has no box
    assert.equal(load({ kind: 'step', step: './gone.step', path: join(p.root, 'gone.step') }), null)
  } finally { p.done() }
})

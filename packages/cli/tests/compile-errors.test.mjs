import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { errorText, errorSource, errorTrace, errorFrame } from '../dist/project/errors.js'
import { workerCompiler } from '../dist/session/worker-client.js'
import { slotDiagnostics } from '../dist/project/report.js'
import { serveSession } from './fixtures/proc.mjs'
import { connectSession } from '../dist/session/client.js'

const internal = '    at fail (file:///project/node_modules/@pcbjs/compile/dist/flatten.js:2470:19)'
test('public errors show source and guidance; verbose alone includes internal frames', () => {
  const error = {
    name: 'CompileError',
    message: 'pair route: P endpoints must be on the same net\n  J9/48: DATA_P\n  J1/33: DATA_N\nCheck the [P, N] order. (pcb.tsx:3:7)',
    src: { file: 'pcb.tsx', line: 3, col: 7, endLine: 3, endCol: 18 },
    stack: ['Error', internal, '    at Array.from (<anonymous>)'].join('\n'),
    frame: '  2 | <PCB>\n> 3 |       {route(a,b)}\n    |       ^^^^^^^^^^^',
  }
  const publicError = errorText(error, false, '/project')
  assert.equal(publicError.line, 'pcb.tsx:3:7: pair route: P endpoints must be on the same net')
  assert.match(publicError.detail.join('\n'), /J9\/48: DATA_P/)
  assert.match(publicError.detail.join('\n'), /> 3 \|/)
  assert.doesNotMatch(publicError.detail.join('\n'), /node_modules|flatten\.js|Array\.from|pcb\.tsx:3:7/)
  assert.deepEqual(errorTrace(error, '/project'), [])
  assert.match(errorText(error, true, '/project').detail.join('\n'), /Debug stack:[\s\S]*flatten\.js/)
})

test('author call chains retain useful frames and remove runtime/dependency frames', () => {
  const error = {
    message: 'Bad pad',
    stack: [
      'Error: Bad pad',
      internal,
      '    at part (file:///project/lib/part.tsx:4:3)',
      '    at build (file:///project/pcb.tsx:12:5)',
      '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n'),
  }
  assert.deepEqual(errorSource(error), { file: '/project/lib/part.tsx', line: 4, col: 3 })
  assert.equal(errorText(error, false, '/project').line, 'lib/part.tsx:4:3: Bad pad')
  assert.deepEqual(errorTrace(error, '/project'), ['  at pcb.tsx:12:5'])
  assert.equal(errorText({ message: 'Unexpected failure', stack: 'Error\n' + internal }).detail.length, 0)
})

test('loader columns become 1-based; source excerpts use supplied unsaved text and ranges', () => {
  const error = { message: 'Unexpected token', loc: { file: '/project/pcb.tsx', line: 2, column: 0 } }
  assert.equal(errorSource(error).col, 1)
  assert.match(
    errorFrame(error, '/project', () => 'before\nUNSAVED\nafter'),
    /> 2 \| UNSAVED\n    \| \^/,
  )
  assert.equal(
    errorFrame(error, '/project', () => null),
    undefined,
  )
  assert.equal(
    errorFrame({ src: { file: '/project/pcb.tsx', line: 99, col: 1 } }, '/project', () => 'short'),
    undefined,
  )
})

const source = [
  "import PCB, { defineFootprint, nets, route } from '@pcbjs/core'",
  "const Pad = defineFootprint(p => <footprint {...p}><pad num={1} at=\"0 0\" size={1}/><pad num={2} at=\"2 0\" size={1}/></footprint>, { pins: ['1', '2'], prefix: 'J' })",
  'const { DATA_P, DATA_N } = nets()',
  'const J9 = Pad().connect({ 1: DATA_P, 2: DATA_N })',
  'const J1 = Pad().connect({ 1: DATA_P, 2: DATA_N })',
  'export default <PCB name="PairError">',
  '  <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20}/>',
  '  <J9 at="5 5"/><J1 at="20 5"/>',
  '  {route([J9[1], J9[2]], [J1[2], J1[1]]).width(0.2).gap(0.2)}',
  '</PCB>',
].join('\n')
const repo = resolve(import.meta.dirname, '../../..')
test('halted previews exclude later entities, recover evaluation failures, and clear after a correction', { timeout: 30000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-prefix-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(repo, 'node_modules/@pcbjs'), join(root, 'node_modules/@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "export default { entries: ['pcb.tsx'] }")
  const file = join(root, 'pcb.tsx')
  const code = source.replace('export default', 'const J2 = Pad()\nexport default').replace('</PCB>', '  <J2 at="25 5"/>\n</PCB>')
  writeFileSync(file, code)
  const compiler = workerCompiler({ root, configFile: join(root, 'pcb.config.ts'), log() {} })
  const entry = { file, rel: 'pcb.tsx' }
  try {
    const prefix = error => {
      assert.ok(error.preview?.length, error.message)
      const site = error.preview[0].site
      assert.deepEqual(
        site.footprints.map(p => p.ref),
        ['J9', 'J1'],
        `placements after the failure are excluded: ${JSON.stringify(error.src)} ${JSON.stringify(error.preview?.[0]?.site.halted)} ${error.message}`,
      )
      assert.equal(site.fab.url, '')
      assert.deepEqual(site.drc, [])
      assert.deepEqual(site.erc, [])
      return true
    }
    await assert.rejects(compiler.compile(entry, { draft: false }), prefix)
    const thrown = code.replace('route([J9[1], J9[2]], [J1[2], J1[1]]).width(0.2).gap(0.2)', 'missingRoute()')
    compiler.draft(file, { code: thrown, limit: null })
    await assert.rejects(compiler.compile(entry, { draft: true }), error => {
      prefix(error)
      assert.equal(error.preview[0].site.halted.stage, 'evaluate')
      return true
    })
    compiler.draft(file, { code: code.replace('[J1[2], J1[1]]', '[J1[1], J1[2]]'), limit: null })
    const out = await compiler.compile(entry, { draft: true })
    assert.equal(out[0].site.halted, undefined)
    assert.deepEqual(
      out[0].site.footprints.map(p => p.ref),
      ['J9', 'J1', 'J2'],
    )
  } finally {
    await compiler.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('pair error survives worker transport with its exact draft range and clean diagnostics', { timeout: 30000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-error-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(repo, 'node_modules/@pcbjs'), join(root, 'node_modules/@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "export default { entries: ['pcb.tsx'] }")
  const file = join(root, 'pcb.tsx')
  writeFileSync(file, source.replace('[J1[2], J1[1]]', '[J1[1], J1[2]]'))
  const compiler = workerCompiler({ root, configFile: join(root, 'pcb.config.ts'), log() {} })
  try {
    compiler.draft(file, { code: source, limit: null })
    await assert.rejects(compiler.compile({ file, rel: 'pcb.tsx' }, { draft: true }), error => {
      assert.equal(error.name, 'CompileError', error.message)
      assert.equal(resolve(root, error.src.file), file)
      assert.equal(error.src.line, 9)
      assert.ok(error.src.endCol > error.src.col)
      assert.match(error.frame, /\[J1\[2\], J1\[1\]\]/)
      const display = errorText(error, false, root)
      assert.match(display.line, /^pcb\.tsx:9:\d+: pair route: P endpoints/)
      assert.match(display.detail.join('\n'), /J9\/1: DATA_P\n  J1\/2: DATA_N/)
      assert.doesNotMatch(JSON.stringify(display), /flatten\.js|node_modules|at fail/)
      const diagnostics = slotDiagnostics({ root }, { entry: { file, rel: 'pcb.tsx' }, compiled: null }, error)
      assert.equal(diagnostics[0].src.file, 'pcb.tsx')
      assert.equal(diagnostics[0].src.start[0], 9)
      assert.match(error.stack, /flatten\.(?:js|ts)/, 'debug trace remains available locally')
      assert.ok(error.preview?.length, 'current-source prefix is recovered')
      assert.deepEqual(
        error.preview[0].site.footprints.map(p => p.ref),
        ['J9', 'J1'],
      )
      assert.equal(error.preview[0].site.halted.stage, 'manual')
      assert.deepEqual(error.preview[0].site.drc, [])
      assert.deepEqual(error.preview[0].site.erc, [])
      assert.equal(error.preview[0].site.fab.status, 'incomplete')
      return true
    })
  } finally {
    await compiler.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('preview payloads and error events carry source context without internal stacks, even in verbose mode', { timeout: 30000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-error-live-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(repo, 'node_modules/@pcbjs'), join(root, 'node_modules/@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "export default { entries: ['pcb.tsx'] }")
  writeFileSync(join(root, 'pcb.tsx'), source)
  let server, client
  try {
    server = await serveSession(root, ['--verbose'])
    client = await connectSession(server.info.socket, { role: 'viewer', project: root })
    const base = 'http://127.0.0.1:' + server.port
    const workspace = await (await fetch(base + '/__pcbjs/scopes')).json()
    const slug = workspace.scopes[0].slug
    const payload = await (await fetch(base + '/__pcbjs/scope/' + slug)).json()
    const text = payload.errors['pcb.tsx']
    assert.equal(payload.boards[0].facets.meta.halted.stage, 'manual')
    assert.deepEqual(
      payload.boards[0].facets.meta.footprints.map(p => p.ref),
      ['J9', 'J1'],
    )
    assert.match(text, /pcb\.tsx:9:\d+: pair route: P endpoints/)
    assert.match(text, />\s+9 \|.*route/)
    assert.doesNotMatch(text, /node_modules|flatten\.(?:js|ts)|Array\.from/)
    let failure
    client.onEvent((event, data) => {
      if (event === 'pcbjs:error') failure = data
    })
    await client.request('session/observe', { scope: slug, board: null, target: null, facets: ['meta', 'layers'] })
    writeFileSync(join(root, 'pcb.tsx'), source.replaceAll('DATA_P', 'UPDATED_P'))
    const deadline = Date.now() + 10000
    while ((!failure || !failure.text.includes('UPDATED_P')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(failure?.text.includes('UPDATED_P'), 'live error event arrives after the edit')
    assert.match(failure.text, />\s+9 \|.*route/)
    assert.doesNotMatch(JSON.stringify(failure), /node_modules|flatten\.(?:js|ts)|Array\.from/)
    const artifact = await fetch(base + '/__pcbjs/PairError/PairError.pcb.svg')
    assert.notEqual(artifact.status, 200)
    assert.match(await artifact.text(), /Compilation halted/)
    let recovered
    client.onEvent((event, data) => {
      if (event === 'pcbjs:boards' && data.errors?.['pcb.tsx'] === null) recovered = data
    })
    writeFileSync(join(root, 'pcb.tsx'), source.replace('[J1[2], J1[1]]', '[J1[1], J1[2]]'))
    const fixedBy = Date.now() + 10000
    while (!recovered && Date.now() < fixedBy) await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(recovered, 'correcting the source clears the live compile error')
    assert.equal(recovered.boards[0].facets.meta.halted, undefined)
    assert.equal(recovered.boards[0].facets.meta.stale, undefined)
    failure = null
    writeFileSync(join(root, 'pcb.tsx'), 'throw new Error("Failed before board construction")')
    const fallbackBy = Date.now() + 10000
    while (!failure && Date.now() < fallbackBy) await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(failure, 'an unrecoverable failure is reported')
    const fallback = await (await fetch(base + '/__pcbjs/scope/' + slug)).json()
    assert.equal(fallback.boards[0].facets.meta.stale, true)
    assert.equal(fallback.boards[0].facets.meta.halted, undefined, 'last good geometry is never labelled as a current-source prefix')
  } finally {
    client?.close()
    await server?.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

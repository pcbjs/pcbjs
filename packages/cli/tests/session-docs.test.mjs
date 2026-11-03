// The session's documents and snapshots: an editor's unsaved text in check and tsc, a write to a restored buffer made on the disk and
// replacing the buffer at its version, a CLI writer through the session into the editor's buffer, an agent kept off a file an editor holds,
// a disk write seen by the next check and shadowed under an editor, gapless frames and the heartbeat, an old reference resolved.
import { parseSnapshot } from '@pcbjs/core/protocol'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { board } from './fixtures/workspace.mjs'
import { stop } from './fixtures/proc.mjs'
import { textDoc } from '@pcbjs/core/internal/textdoc'
import { anchor, sourceWriter } from '../dist/session/source-write.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'react-jsx',
    jsxImportSource: '@pcbjs/core',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  include: ['*.tsx'],
})

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function project(name) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-docs-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
  writeFileSync(join(root, 'pcb.tsx'), board(name))
  return root
}

async function until(fn, ms = 30000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}

/** `pcbjs session serve` in the foreground on a free port, as a worker runs it. */
async function serve(root) {
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
  return {
    info,
    log: () => out,
    stop: async () => {
      await stop(child)
    },
  }
}

/** A JSON-RPC client on the session's WebSocket: requests, notifications, and every frame it got. */
async function client(info, role, project) {
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(info.url).port}/__pcbjs/session`)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const frames = []
  const waits = new Map()
  let id = 0
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    frames.push(m)
    if (m.jsonrpc && m.id !== undefined && waits.has(m.id) && !m.method) {
      const w = waits.get(m.id)
      waits.delete(m.id)
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
  })
  const send = m => ws.send(JSON.stringify(m))
  send({ event: 'pcbjs:ide:hello', data: { name: `test ${role}`, version: '0', protocol: 2, major: 1, capabilities: [], role, project } })
  const c = {
    frames,
    request: (method, params = {}) =>
      new Promise((ok, fail) => {
        waits.set(++id, { ok, fail })
        send({ jsonrpc: '2.0', id, method, params })
      }),
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
    reply: (id, result) => send({ jsonrpc: '2.0', id, result }),
    next: async pred => {
      let hit
      await until(() => (hit = frames.find(pred)))
      return hit
    },
    close: () => ws.close(),
  }
  await c.next(m => m.event === 'pcbjs:ide:ready')
  return c
}

const init = async (c, root) => {
  await c.request('initialize', { processId: null, rootUri: pathToFileURL(root).href, capabilities: { workspace: { applyEdit: true } } })
  c.notify('initialized', {})
}
const open = (c, file, text, version = 1) => c.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: 'typescriptreact', version, text } })
const moved = name => board(name).replace('15mm 10mm', '25mm 10mm')
const wrongType = "\nexport const wrong: number = 'x'\n"

test('an editor’s unsaved text shows in check and tsc, and the save hands the file back to disk', { timeout: 120000 }, async () => {
  const root = project('Unsaved')
  const s = await serve(root)
  try {
    const ed = await client(s.info, 'editor', root)
    await init(ed, root)
    const file = join(root, 'pcb.tsx')
    open(ed, file, moved('Unsaved') + wrongType, 2)
    const r = await ed.request('session/check')
    assert.deepEqual(r.overlay, ['pcb.tsx'])
    assert.equal(r.stale, null)
    assert.equal(r.value.exitCode, 1)
    assert.match(r.value.stdout, /edge-clearance/)
    assert.match(r.value.stdout, /typecheck {2}1 error/)
    assert.match(r.value.stdout, /TS2322/)
    assert.ok(!existsSync(join(root, '.pcbjs', 'typecheck.json')), 'an overlaid tsc run writes no cache')
    // the disk is still clean, as an in-process check says
    const disk = execFileSync(process.execPath, [BIN, 'check', '--fresh'], { cwd: root, encoding: 'utf8' })
    assert.doesNotMatch(disk, /edge-clearance|TS2322/)
    // the save: disk takes the text and the editor lets go of the file
    writeFileSync(file, moved('Unsaved'))
    ed.notify('textDocument/didSave', { textDocument: { uri: pathToFileURL(file).href } })
    const after = await ed.request('session/check')
    assert.deepEqual(after.overlay, [])
    assert.match(after.value.stdout, /edge-clearance/)
    assert.doesNotMatch(after.value.stdout, /TS2322/)
    assert.notEqual(after.snapshot, r.snapshot)
    // every frame numbered from 1 with no gap, and a heartbeat naming the snapshot's run
    const run = parseSnapshot(after.snapshot).run
    await ed.next(m => m.event === 'session/state' && m.data.run === run)
    assert.deepEqual(
      ed.frames.map(f => f.seq),
      ed.frames.map((_, i) => i + 1),
    )
    const beat = ed.frames.find(m => m.event === 'session/state' && m.data.run === run)
    assert.equal(beat.data.seq, undefined, 'the frame alone carries seq')
    assert.match(Object.keys(beat.data.facets).join(), /meta:Unsaved/)
    ed.close()
  } finally {
    await s.stop()
  }
})

test('an unedited editor text unlike the disk, as a restored backup, compiles the disk until the editor edits it', { timeout: 120000 }, async () => {
  const root = project('Restored')
  const s = await serve(root)
  try {
    const ed = await client(s.info, 'editor', root)
    await init(ed, root)
    const file = join(root, 'pcb.tsx')
    // the text an editor restores from before a write on disk: version 1, no edit of it ever reached the session
    open(ed, file, moved('Restored') + wrongType)
    const r = await ed.request('session/check')
    assert.deepEqual(r.overlay, [])
    assert.equal(r.value.exitCode, 0, r.value.stdout)
    assert.match(s.log(), /pcb\.tsx: test editor opened unsaved text unlike the disk that no edit of it produced; the session compiles the disk/)
    const warned = await ed.next(m => m.method === 'textDocument/publishDiagnostics' && m.params.diagnostics.some(d => d.code === 'shadowed'))
    assert.match(warned.params.diagnostics.find(d => d.code === 'shadowed').message, /restored unlike the disk/)
    // the first edit makes it the editor's unsaved text again
    ed.notify('textDocument/didChange', { textDocument: { uri: pathToFileURL(file).href, version: 2 }, contentChanges: [{ text: moved('Restored') + wrongType + '\n' }] })
    const edited = await ed.request('session/check')
    assert.deepEqual(edited.overlay, ['pcb.tsx'])
    assert.equal(edited.value.exitCode, 1)
    assert.match(edited.value.stdout, /edge-clearance/)
    assert.match(s.log(), /test editor edited, saved or closed the unsaved text it opened/)
    ed.close()
  } finally {
    await s.stop()
  }
})

test('a write to a restored buffer is made on the disk text and replaces the buffer at the version it opened', { timeout: 120000 }, async () => {
  const root = project('RestoredWrite')
  const s = await serve(root)
  try {
    const ed = await client(s.info, 'editor', root)
    await ed.request('initialize', {
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: { workspace: { applyEdit: true, workspaceEdit: { documentChanges: true } } },
    })
    ed.notify('initialized', {})
    const file = join(root, 'pcb.tsx')
    const uri = pathToFileURL(file).href
    const buffer = moved('RestoredWrite') + wrongType
    open(ed, file, buffer)
    await until(() => /pcb\.tsx: test editor opened unsaved text unlike the disk/.test(s.log()))
    const agent = await client(s.info, 'agent', root)
    const read = await agent.request('session/read', { file })
    assert.deepEqual([read.authority, read.version, read.text], ['restored', 1, board('RestoredWrite')])
    const writing = agent.request('session/write', { file, edits: [{ old: '15mm 10mm', new: '35mm 10mm' }] })
    const asked = await ed.next(m => m.method === 'workspace/applyEdit')
    const [change] = asked.params.edit.documentChanges
    assert.deepEqual(change.textDocument, { uri, version: 1 })
    const next = textDoc(buffer).apply(change.edits)
    assert.equal(next, board('RestoredWrite').replace('15mm 10mm', '35mm 10mm'), 'the disk text with the edit, in place of the buffer')
    ed.reply(asked.id, { applied: true })
    ed.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: next }] })
    const w = await writing
    assert.deepEqual([w.via, w.applied], ['editor', true])
    assert.equal(readFileSync(file, 'utf8'), board('RestoredWrite'), 'the disk stays until the editor saves')
    await until(() => /test editor edited, saved or closed the unsaved text it opened/.test(s.log()))
    const after = await agent.request('session/read', { file })
    assert.deepEqual([after.authority, after.version, after.text], ['editor', 2, next])
    agent.close()
    ed.close()
  } finally {
    await s.stop()
  }
})

test('anchor: the changed span grown by whole lines until it occurs once', () => {
  const text = 'a\nx = 1\nb\nx = 1\n'
  assert.deepEqual(anchor(text, 'a\nx = 1\nb\nx = 2\n'), { old: 'b\nx = 1\n', new: 'b\nx = 2\n' })
  assert.deepEqual(anchor('one two', 'one 2'), { old: 'two', new: '2' })
  const t = 'p\nq\n'
  const a = anchor(t, 'p\nr\nq\n')
  assert.equal(t.replace(a.old, a.new), 'p\nr\nq\n')
})

test('a CLI writer with a session live writes through it into the editor holding the file, never under it on disk', { timeout: 120000 }, async () => {
  const root = project('CliWrite')
  const s = await serve(root)
  try {
    const ed = await client(s.info, 'editor', root)
    await init(ed, root)
    const file = join(root, 'pcb.tsx')
    const uri = pathToFileURL(file).href
    const disk = board('CliWrite')
    const buffer = disk + '// unsaved\n'
    open(ed, file, buffer, 2)
    await ed.request('session/events', {})
    const w = await sourceWriter(root, 'test cli')
    const writing = w.write(file, disk, disk.replace('15mm 10mm', '35mm 10mm'))
    const asked = await ed.next(m => m.method === 'workspace/applyEdit')
    const next = textDoc(buffer).apply(asked.params.edit.changes[uri])
    assert.equal(next, buffer.replace('15mm 10mm', '35mm 10mm'), 'the edit lands in the buffer, its unsaved line kept')
    ed.reply(asked.id, { applied: true })
    const done = await writing
    w.close()
    assert.deepEqual([done.via, done.applied], ['editor', true])
    assert.equal(readFileSync(file, 'utf8'), disk)
    ed.close()
  } finally {
    await s.stop()
  }
})

test('an agent’s sync of a file an editor holds is ignored, with one log message', { timeout: 120000 }, async () => {
  const root = project('Held')
  const s = await serve(root)
  try {
    const file = join(root, 'pcb.tsx')
    const ed = await client(s.info, 'editor', root)
    await init(ed, root)
    open(ed, file, moved('Held'), 2)
    await ed.request('session/events', {})
    const agent = await client(s.info, 'agent', root)
    await init(agent, root)
    open(agent, file, board('Held') + wrongType)
    agent.notify('textDocument/didChange', { textDocument: { uri: pathToFileURL(file).href, version: 2 }, contentChanges: [{ text: board('Held') + wrongType + '\n' }] })
    const note = await agent.next(m => m.method === 'window/logMessage')
    assert.match(note.params.message, /is open in an editor/)
    const r = await agent.request('session/check')
    assert.match(r.value.stdout, /edge-clearance/, "the editor's text compiles")
    assert.doesNotMatch(r.value.stdout, /TS2322/, "the agent's does not")
    await new Promise(r => setTimeout(r, 300))
    assert.equal(agent.frames.filter(m => m.method === 'window/logMessage').length, 1, 'one message per file')
    // the editor leaves: its text goes, and the agent's next sync takes the file
    ed.close()
    await new Promise(r => setTimeout(r, 300))
    agent.notify('textDocument/didChange', { textDocument: { uri: pathToFileURL(file).href, version: 3 }, contentChanges: [{ text: board('Held') + wrongType }] })
    const mine = await agent.request('session/check')
    assert.match(mine.value.stdout, /TS2322/)
    agent.close()
  } finally {
    await s.stop()
  }
})

test('a disk write and an immediate check: the check sees it; under an editor it stays shadowed and the editor is told', { timeout: 120000 }, async () => {
  const root = project('Disk')
  const s = await serve(root)
  try {
    const file = join(root, 'pcb.tsx')
    const agent = await client(s.info, 'agent', root)
    const first = await agent.request('session/check')
    assert.doesNotMatch(first.value.stdout, /edge-clearance/)
    writeFileSync(file, moved('Disk'))
    const seen = await agent.request('session/check')
    assert.match(seen.value.stdout, /edge-clearance/, 'stamping catches the write before the watcher does')
    assert.equal(seen.stale, null)
    // an editor opens the file with the clean text; a disk write under it stays shadowed
    const ed = await client(s.info, 'editor', root)
    await init(ed, root)
    open(ed, file, board('Disk'), 2)
    // two sockets carry no order between them: the editor's own request answers once its server took the open
    await ed.request('session/events', {})
    const clean = await agent.request('session/check')
    assert.doesNotMatch(clean.value.stdout, /edge-clearance/)
    const since = (await agent.request('session/events', {})).next
    writeFileSync(file, moved('Disk') + '\n')
    const shadowed = await agent.request('session/check')
    assert.doesNotMatch(shadowed.value.stdout, /edge-clearance/, "the editor's text still compiles")
    assert.deepEqual(shadowed.overlay, ['pcb.tsx'])
    const diag = await ed.next(m => m.method === 'textDocument/publishDiagnostics' && m.params.diagnostics.some(d => d.code === 'shadowed'))
    assert.match(diag.params.diagnostics.find(d => d.code === 'shadowed').message, /changed on disk/)
    const { events } = await agent.request('session/events', { since })
    const e = events.find(x => x.kind === 'edit')
    assert.deepEqual(e.data, { file: 'pcb.tsx', source: 'disk', ranges: null, shadowed: true })
    // the editor saves its own text: the shadow and its diagnostic go
    writeFileSync(file, board('Disk'))
    ed.notify('textDocument/didSave', { textDocument: { uri: pathToFileURL(file).href } })
    await ed.next(
      m => m.method === 'textDocument/publishDiagnostics' && m.params.uri.endsWith('pcb.tsx') && !m.params.diagnostics.some(d => d.code === 'shadowed') && m.seq > diag.seq,
    )
    ed.close()
    agent.close()
  } finally {
    await s.stop()
  }
})

test('a claimed disk write under an editor is shadowed and names the agent that claimed it', { timeout: 120000 }, async () => {
  const root = project('Claim')
  const s = await serve(root)
  try {
    const file = join(root, 'pcb.tsx')
    const ed = await client(s.info, 'editor', root)
    await init(ed, root)
    open(ed, file, board('Claim'))
    await ed.request('session/events', {})
    const agent = await client(s.info, 'agent', root)
    await agent.request('session/check')
    const since = (await agent.request('session/events', {})).next
    await agent.request('session/edited', { file: 'pcb.tsx' })
    writeFileSync(file, moved('Claim'))
    await agent.request('session/check')
    await until(async () => (await agent.request('session/events', { since })).events.some(e => e.kind === 'edit' && e.data.shadowed))
    const e = (await agent.request('session/events', { since })).events.find(x => x.kind === 'edit' && x.data.shadowed)
    assert.deepEqual(e.data, { file: 'pcb.tsx', source: 'agent', ranges: null, shadowed: true })
    assert.equal(e.by.role, 'agent')
    ed.close()
    agent.close()
  } finally {
    await s.stop()
  }
})

test('an old finding id and an old part ref resolve in the current snapshot by lineage', { timeout: 120000 }, async () => {
  const root = project('Lineage')
  const file = join(root, 'pcb.tsx')
  writeFileSync(file, moved('Lineage'))
  const s = await serve(root)
  try {
    const json = join(root, 'report.json')
    const ids = () => {
      try {
        execFileSync(process.execPath, [BIN, 'check', '--json', json], { cwd: root, stdio: 'pipe' })
      } catch {}
      return JSON.parse(readFileSync(json, 'utf8'))
        .boards[0].findings.filter(f => f.rule === 'edge-clearance')
        .map(f => f.id)
    }
    const agent = await client(s.info, 'agent', root)
    await agent.request('session/check')
    const [old] = ids()
    // the pad moves along the edge, so the finding's id changes, and TP2 becomes TPX
    writeFileSync(file, moved('Lineage').replace('25mm 10mm', '25mm 11mm'))
    await agent.request('session/check')
    const [now] = ids()
    assert.notEqual(now, old)
    const f = await agent.request('session/resolve', { reference: old })
    assert.deepEqual(f.value.stale, { reason: 'changed', current: now })
    assert.equal(f.value.ref, now)
    assert.deepEqual(f.stale, { reason: 'changed', current: now })
    const exact = await agent.request('session/resolve', { reference: now })
    assert.equal(exact.stale, null)
    // a rename: the call that made TP2 makes TPX now
    writeFileSync(file, readFileSync(file, 'utf8').replaceAll('TP2', 'TPX'))
    await agent.request('session/check')
    const renamed = await agent.request('session/resolve', { reference: 'TP2' })
    assert.deepEqual(renamed.value, { kind: 'part', ref: 'TPX', stale: { reason: 'changed', current: 'TPX' } })
    const gone = await agent.request('session/resolve', { reference: 'TP9' })
    assert.equal(gone.value.stale.reason, 'gone')
    assert.deepEqual(gone.value.candidates, ['TP1', 'TPX'])
    // any reference: a pad of the renamed part follows it, a net is exact
    const pad = await agent.request('session/resolve', { reference: 'TP2/1' })
    assert.deepEqual(pad.value, { kind: 'pad', ref: 'TPX/1', stale: { reason: 'changed', current: 'TPX/1' } })
    assert.deepEqual((await agent.request('session/resolve', { reference: 'TPX/1' })).value, { kind: 'pad', ref: 'TPX/1', stale: null })
    agent.close()
  } finally {
    await s.stop()
  }
})

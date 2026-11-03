// The session's agent surfaces: the events log in its three modes with a reset, the demand rule, scoped subscriptions, `by` on an editor's
// edit, an agent's claimed write and a write nobody claimed, `script` with its timeout and `--watch`, and `q` with lineage.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { board } from './fixtures/workspace.mjs'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function project(name) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-agent-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), board(name))
  return root
}

const moved = (name, x = '25mm') => board(name).replace('15mm 10mm', `${x} 10mm`)

async function until(fn, ms = 30000) {
  const t0 = Date.now()
  let v
  while (!(v = await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
  return v
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const cli = (root, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 120000 })

/** A command left running, its output collected. */
function running(root, ...args) {
  const p = spawn(process.execPath, [BIN, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(p)
  const o = { out: '', err: '', code: null, exited: new Promise(r => p.once('exit', c => r((o.code = c)))) }
  p.stdout.on('data', d => (o.out += d))
  p.stderr.on('data', d => (o.err += d))
  return Object.assign(o, {
    kill: s => p.kill(s),
    lines: () =>
      o.out
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l)),
  })
}

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
    stop: async () => {
      await stop(child)
    },
  }
}

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
    events: () => frames.filter(f => f.event === 'session/event').map(f => f.data),
    request: (method, params = {}) =>
      new Promise((ok, fail) => {
        waits.set(++id, { ok, fail })
        send({ jsonrpc: '2.0', id, method, params })
      }),
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
    close: () => ws.close(),
  }
  await until(() => frames.some(m => m.event === 'pcbjs:ide:ready'))
  return c
}

test(
  'events: none without a session; --since, --wait and --follow as JSON lines, a reset for a stale cursor; an edit compiles only for an observer',
  { timeout: 120000 },
  async () => {
    const root = project('Events')
    assert.equal(cli(root, 'events').status, 3, 'no session: exit 3')
    const s = await serve(root)
    try {
      const agent = await client(s.info, 'agent', root)
      await agent.request('session/check')
      const start = JSON.parse(cli(root, 'events').stdout)
      assert.match(start.next, new RegExp(`^${s.info.session}:\\d+$`), 'without a cursor only the next line')
      const idle = cli(root, 'events', '--since', start.next, '--wait', '--for', 'findings', '--timeout', '1')
      assert.equal(idle.status, 124, 'nothing compiled within the timeout')
      assert.deepEqual(JSON.parse(idle.stdout.trim()), { next: start.next })
      // no observer: the write is an edit, and nothing compiles
      writeFileSync(join(root, 'pcb.tsx'), moved('Events'))
      await until(() => cli(root, 'events', '--since', start.next).stdout.includes('"kind":"edit"'), 10000)
      await sleep(800)
      const quiet = cli(root, 'events', '--since', start.next)
        .stdout.split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l))
      assert.deepEqual(
        quiet.filter(e => e.kind).map(e => e.kind),
        ['edit'],
      )
      assert.deepEqual(quiet[0].data, { file: 'pcb.tsx', source: 'disk', ranges: null })
      assert.equal(quiet[0].by, null)
      // a wait for findings observes: the waiting edit compiles, and it ends at the first findings event
      const waited = cli(root, 'events', '--since', start.next, '--wait', '--for', 'findings', '--timeout', '60')
      assert.equal(waited.status, 0, waited.stderr)
      const lines = waited.stdout
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l))
      const kinds = lines.filter(e => e.kind).map(e => e.kind)
      assert.equal(kinds.at(-1), 'findings')
      assert.ok(kinds.includes('compile'), kinds.join())
      const f = lines.find(e => e.kind === 'findings')
      assert.deepEqual([f.data.board, f.data.errors, f.data.drc.errors, f.data.unconnected], ['Events', 2, 2, 1])
      assert.ok(f.data.added.some(id => id.startsWith('drc:edge-clearance:')))
      assert.deepEqual(lines.at(-1), { next: f.id })
      // ids are gapless
      const all = cli(root, 'events', '--since', `${s.info.session}.0`)
        .stdout.split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l))
      assert.deepEqual(
        all.filter(e => e.id).map(e => Number(e.id.split(':')[1])),
        all.filter(e => e.id).map((_, i) => i + 1),
      )
      // --follow: a cursor of another session starts with a reset, then every event, then the end
      const follow = running(root, 'events', '--follow', '--since', 'zzzzzzzz.4', '--kind', 'edit,findings')
      await until(() => follow.out.includes('"reset"'))
      assert.deepEqual(Object.keys(follow.lines()[0]), ['reset', 'next'])
      assert.equal(follow.lines()[0].reset, 'another session')
      const seen = follow.lines().length
      writeFileSync(join(root, 'pcb.tsx'), moved('Events', '14mm'))
      await until(() =>
        follow
          .lines()
          .slice(seen)
          .some(e => e.kind === 'findings'),
      )
      assert.ok(
        follow
          .lines()
          .slice(seen)
          .every(e => e.kind === 'edit' || e.kind === 'findings'),
      )
      follow.kill('SIGINT')
      await follow.exited
      assert.deepEqual(follow.lines().at(-1), { end: 'interrupted' })
      agent.close()
    } finally {
      await s.stop()
    }
  },
)

test('a query that compiled an edit serves its watcher event: an observer sees one compile', { timeout: 120000 }, async () => {
  const root = project('Served')
  const s = await serve(root)
  try {
    const agent = await client(s.info, 'agent', root)
    await agent.request('session/check')
    const follow = running(root, 'events', '--follow', '--kind', 'findings')
    await sleep(1500)
    for (const x of ['25mm', '14mm', '20mm']) {
      const seen = follow.lines().length
      writeFileSync(join(root, 'pcb.tsx'), moved('Served', x))
      await agent.request('session/check')
      await sleep(1500)
      const found = follow
        .lines()
        .slice(seen)
        .filter(e => e.kind === 'findings')
      assert.equal(found.length, 1, `${x}: ${JSON.stringify(found)}`)
    }
    follow.kill('SIGINT')
    await follow.exited
    agent.close()
  } finally {
    await s.stop()
  }
})

test('scoped subscriptions: a subscriber of TP2 gets the edit and the findings that touch TP2, one of TP9 nothing, a file scope its file', { timeout: 120000 }, async () => {
  const root = project('Scoped')
  const s = await serve(root)
  try {
    const agent = await client(s.info, 'agent', root)
    await agent.request('session/check')
    const tp2 = await client(s.info, 'agent', root)
    const tp9 = await client(s.info, 'agent', root)
    const file = await client(s.info, 'agent', root)
    await tp2.request('session/events', { follow: true, scope: ['TP2'] })
    await tp9.request('session/events', { follow: true, scope: ['TP9', 'net:W'] })
    await file.request('session/events', { follow: true, scope: ['pcb.tsx'], kind: ['edit'] })
    writeFileSync(join(root, 'pcb.tsx'), moved('Scoped'))
    await until(() => tp2.events().some(e => e.kind === 'findings'))
    const kinds = tp2.events().map(e => e.kind)
    assert.ok(kinds.includes('edit'), kinds.join())
    assert.ok(kinds.includes('compile'), 'a compile touches every scope')
    assert.ok(
      tp2
        .events()
        .find(e => e.kind === 'findings')
        .data.added.some(id => id.startsWith('drc:edge-clearance:')),
    )
    await until(() => file.events().length)
    assert.deepEqual(
      file.events().map(e => [e.kind, e.data.file]),
      [['edit', 'pcb.tsx']],
    )
    await sleep(300)
    assert.deepEqual(
      tp9.events().filter(e => e.kind !== 'compile'),
      [],
    )
    for (const c of [agent, tp2, tp9, file]) c.close()
  } finally {
    await s.stop()
  }
})

test('by: an editor’s edit and save name the editor, an agent’s claimed write the agent, an unclaimed write nobody', { timeout: 120000 }, async () => {
  const root = project('By')
  const s = await serve(root)
  try {
    const file = join(root, 'pcb.tsx')
    const watch = await client(s.info, 'cli', root)
    await watch.request('session/events', { follow: true, kind: ['edit', 'save'] })
    const ed = await client(s.info, 'editor', root)
    await ed.request('initialize', { processId: null, rootUri: pathToFileURL(root).href, capabilities: {} })
    ed.notify('initialized', {})
    const uri = pathToFileURL(file).href
    ed.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text: board('By') } })
    ed.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: moved('By') }] })
    const edit = await until(() => watch.events().find(e => e.kind === 'edit'))
    assert.equal(edit.data.source, 'editor')
    assert.deepEqual(edit.by, { client: edit.by.client, name: 'test editor', role: 'editor' })
    assert.match(edit.by.client, /^c\d+$/)
    assert.equal(edit.data.ranges.length, 1)
    assert.equal(
      edit.data.ranges[0].start[0],
      board('By')
        .split('\n')
        .findIndex(l => l.includes('15mm 10mm')) + 1,
      'the range starts on the line it changed',
    )
    writeFileSync(file, moved('By'))
    ed.notify('textDocument/didSave', { textDocument: { uri } })
    const save = await until(() => watch.events().find(e => e.kind === 'save'))
    assert.deepEqual([save.data.file, save.by.name], ['pcb.tsx', 'test editor'])
    ed.close()
    await sleep(2500)
    assert.equal(watch.events().filter(e => e.kind === 'edit').length, 1, "the editor's own save is no edit of its own")
    // an agent's tool wrote the file and claims it
    const agent = await client(s.info, 'agent', root)
    await agent.request('session/edited', { file: 'pcb.tsx' })
    writeFileSync(file, moved('By', '14mm'))
    const claimed = await until(() => watch.events().filter(e => e.kind === 'edit')[1])
    assert.equal(claimed.data.source, 'agent')
    assert.equal(claimed.by.name, 'test agent')
    assert.equal(claimed.by.role, 'agent')
    // nobody claims this one: it waits 2 s for a claim, then names nobody
    writeFileSync(file, moved('By', '13mm'))
    const plain = await until(() => watch.events().filter(e => e.kind === 'edit')[2])
    assert.deepEqual([plain.data.source, plain.by], ['disk', null])
    for (const c of [watch, agent]) c.close()
  } finally {
    await s.stop()
  }
})

test('script and q: a timeout exits 124 here and in the session, --watch prints once per change, q follows a rename by lineage', { timeout: 150000 }, async () => {
  const root = project('Script')
  const here = cli(root, 'script', 'while (true) {}', '--timeout', '200')
  assert.equal(here.status, 124, here.stderr)
  assert.match(here.stderr, /ran past 200 ms/)
  const bad = cli(root, 'script', 'const x: number = 1\nnull.y')
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /script:2: Cannot read properties of null/)
  const s = await serve(root)
  try {
    const t = cli(root, 'script', 'while (true) {}', '--timeout', '200')
    assert.equal(t.status, 124, t.stderr)
    assert.match(t.stderr, /^session \w+  snapshot /m)
    const v = cli(root, 'script', "board.part('TP2').at[0]")
    assert.deepEqual([v.status, v.stdout], [0, '15\n'])
    assert.equal(cli(root, 'script', 'typeof process + typeof require + typeof setTimeout').stdout, 'undefinedundefinedundefined\n')
    const w = running(root, 'script', '--watch', "board.part('TP2').at[0]")
    await until(() => w.out === '15\n')
    // a compile that leaves the value prints nothing, one that changes it prints once
    writeFileSync(join(root, 'pcb.tsx'), board('Script') + '\n// a comment\n')
    await sleep(1500)
    writeFileSync(join(root, 'pcb.tsx'), moved('Script'))
    await until(() => w.out.includes('25'))
    await sleep(500)
    assert.equal(w.out, '15\n25\n')
    w.kill('SIGINT')
    await w.exited
    // q: the record, then TP2 renamed answers as TPX
    const q = JSON.parse(cli(root, 'q', 'TP2').stdout)
    assert.deepEqual([q.value.kind, q.value.ref, q.value.at, q.stale], ['part', 'TP2', [25, 10], null])
    assert.equal(cli(root, 'q', 'TP9').status, 1)
    writeFileSync(join(root, 'pcb.tsx'), moved('Script').replaceAll('TP2', 'TPX'))
    const r = cli(root, 'q', 'TP2')
    assert.equal(r.status, 0, r.stderr)
    const renamed = JSON.parse(r.stdout)
    assert.deepEqual(renamed.stale, { reason: 'changed', current: 'TPX' })
    assert.equal(renamed.value.ref, 'TPX')
  } finally {
    await s.stop()
  }
})

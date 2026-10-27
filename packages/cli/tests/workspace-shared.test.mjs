// The workspace dev server with files shared between scopes, as in examples/motor-stack: a lib/ beside the scope folders is
// watched through the module graphs, an edit of it recompiles the displayed scope and marks every other loaded scope that
// imports it stale, and a hidden scope edited long before it is shown again still recompiles.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { devWorkspace } from '../dist/workspace.js'
import { makeStack, shared, stackBoard } from './fixtures/workspace.mjs'

let w, server, workspace, base
const json = async p => JSON.parse(await (await fetch(base + p)).text())
const scope = slug => workspace.scopes.find(s => s.slug === slug)
const watched = () => new Set(Object.entries(server.watcher.getWatched()).flatMap(([d, ns]) => ns.map(n => join(d, n))))
const until = async (fn, what) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise(r => setTimeout(r, 25)); assert.ok(fn(), what) }
const title = slug => scope(slug).state?.slots[0].compiled?.[0].board.title

before(async () => {
  w = makeStack()
  const log = console.log
  console.log = () => {}
  try { ({ server, workspace } = await devWorkspace({ folders: [w.stack], port: 0, host: '127.0.0.1' })) } finally { console.log = log }
  server.config.logger.info = () => {}
  base = `http://127.0.0.1:${server.httpServer.address().port}`
})
after(async () => {
  await server?.close()
  if (w) rmSync(w.root, { recursive: true, force: true })
})

test('shared lib: the lib folder is no scope, and each scope\'s graph holds its file', async () => {
  assert.deepEqual(workspace.scopes.map(s => s.slug), ['a', 'b'])
  assert.deepEqual((await json('/__pcbjs/scope/b')).boards.map(x => [x.name, x.title]), [['B', 'T1']])
  assert.deepEqual((await json('/__pcbjs/scope/a')).boards.map(x => [x.name, x.title]), [['A', 'T1']])
  const file = join(w.lib, 'shared.ts')
  for (const s of ['a', 'b']) assert.ok(scope(s).files.includes(file), `${s}: ${scope(s).files.join(' ')}`)
  assert.ok(watched().has(file), 'the shared file is watched')
})

test('shared lib: an edit recompiles the displayed scope and marks the other one stale', async () => {
  assert.equal(workspace.displayed.slug, 'a')
  await new Promise(r => setTimeout(r, 20))
  writeFileSync(join(w.lib, 'shared.ts'), shared('T2'))
  await until(() => title('a') === 'T2', 'the displayed scope recompiled with the new title')
  await until(() => scope('b').stale, 'the hidden scope that imports it is stale')
  assert.equal(scope('a').stale, false)
  assert.deepEqual((await json('/__pcbjs/scopes')).scopes.map(s => [s.slug, s.stale]), [['a', false], ['b', true]])
  // shown again, it compiles with the new file
  assert.deepEqual((await json('/__pcbjs/scope/b')).boards.map(x => [x.name, x.title]), [['B', 'T2']])
  assert.equal(scope('b').stale, false)
})

test('shared lib: a lib file no scope imports changes nothing', async () => {
  assert.equal(workspace.displayed.slug, 'b')
  writeFileSync(join(w.lib, 'unused.ts'), 'export const UNUSED = 2\n')
  await new Promise(r => setTimeout(r, 400))
  assert.deepEqual(workspace.scopes.map(s => s.stale), [false, false])
})

test('hidden scope: an edit long before it is shown again still recompiles it', async () => {
  assert.equal(workspace.displayed.slug, 'b')
  await new Promise(r => setTimeout(r, 20))
  writeFileSync(join(w.a, 'pcb.tsx'), stackBoard('A', '2'))
  // the reviewer's repro: wait 1.5 s, then show it without asking for the scopes in between
  await new Promise(r => setTimeout(r, 1500))
  const a = await json('/__pcbjs/scope/a')
  assert.deepEqual(a.boards.map(x => [x.name, x.revision]), [['A', '2']])
})

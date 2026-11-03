// The session's parts on their own: a project's realm swapped around a call, edits through an editor or on disk, positions
// mapped through an edit, snapshots and their staleness, the events log's cursor, and tsc over unsaved text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyEdits } from '../dist/session/write.js'
import { textDoc } from '@pcbjs/core/internal/textdoc'
import { pointMap } from '../dist/project/textmap.js'
import { snapshots, staleOf, changedFiles, envelope } from '../dist/session/snapshots.js'
import { eventLog } from '../dist/session/events.js'
import { typecheck } from '../dist/project/typecheck.js'
import { defineDefaultBoard, resetDefaults } from '@pcbjs/core/internal/defaults'
import { inRealm, newRealm, realm, REALM_ABI } from '@pcbjs/core/internal/realm'

const tmp = () => mkdtempSync(join(tmpdir(), 'pcbjs-units-'))

test('inRealm: each project sees its own defaults, KiCad config, model resolver, source mapper and parts, the process keeps its own', async () => {
  resetDefaults()
  const a = newRealm(),
    b = newRealm()
  const mapA = s => s
  await inRealm(a, async () => {
    defineDefaultBoard({ rev: 'A' })
    realm().kicad = { root: '/a', config: {} }
    realm().remoteModel = () => '/a/model.step'
    realm().mapSrc = mapA
    realm().registry.parts.push({ label: 'R1' })
  })
  await inRealm(b, async () => {
    assert.equal(realm().defaults, null, 'b starts clean')
    assert.equal(realm().kicad, null)
    assert.equal(realm().registry.parts.length, 0)
    defineDefaultBoard({ rev: 'B' })
    realm().kicad = { root: '/b', config: {} }
  })
  assert.equal(realm().defaults, null, 'the process keeps none')
  assert.equal(realm().kicad, null)
  assert.equal(realm().mapSrc, null)
  await inRealm(a, async () => {
    assert.equal(realm().defaults.rev, 'A')
    assert.equal(realm().kicad.root, '/a')
    assert.equal(realm().remoteModel(), '/a/model.step')
    assert.equal(realm().mapSrc, mapA)
    assert.equal(realm().registry.parts.length, 1)
  })
  await inRealm(b, async () => {
    assert.equal(realm().defaults.rev, 'B')
    assert.equal(realm().kicad.root, '/b')
    assert.equal(realm().remoteModel, null)
  })
})

test('realm: a realm of another abi throws naming both', async () => {
  await assert.rejects(
    inRealm({ ...newRealm(), abi: REALM_ABI + 1 }, async () => {}),
    new RegExp(`realm abi ${REALM_ABI + 1} and one with ${REALM_ABI}`),
  )
})

test('applyEdits: through the editor that holds the file, else one of the project, else on disk by a rename', async () => {
  const dir = tmp()
  try {
    const file = join(dir, 'pcb.tsx')
    writeFileSync(file, 'one\ntwo three\n')
    const edits = [
      { range: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } }, newText: '3' },
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: '1' },
    ]
    assert.equal(textDoc('one\ntwo three\n').apply(edits), '1\ntwo 3\n')
    // no editor: disk, and no temporary file left
    assert.deepEqual(await applyEdits([{ file, edits }], { hub: null, root: dir }), [{ file, via: 'disk', applied: true }])
    assert.equal(readFileSync(file, 'utf8'), '1\ntwo 3\n')
    assert.deepEqual(readdirSync(dir), ['pcb.tsx'])
    // the holder's connection takes it, by workspace/applyEdit, and disk stays as it is
    const sent = []
    const server = (id, role = 'editor') => ({ holder: { id, role }, initialized: true, applyEdit: async e => (sent.push([id, e]), true) })
    const hub = {
      servers: () => [
        { key: 'other', server: server('e1') },
        { key: 'mine', server: server('e2') },
        { key: 'bot', server: server('a1', 'agent') },
      ],
      store: () => ({ holderOf: f => (f === file ? { id: 'e2', role: 'editor' } : null) }),
    }
    const out = await applyEdits([{ file, edits }], { hub, root: dir, projectOf: () => dir })
    assert.deepEqual(out, [{ file, via: 'editor', applied: true }])
    assert.equal(sent[0][0], 'e2')
    assert.deepEqual(Object.keys(sent[0][1].changes), [`file://${file}`])
    assert.equal(readFileSync(file, 'utf8'), '1\ntwo 3\n')
    // a file nobody holds goes through an editor of the project, never an agent and never on disk under the editor
    const other = join(dir, 'lib.ts')
    writeFileSync(other, 'x\n')
    await applyEdits([{ file: other, edits: [] }], { hub, root: dir, projectOf: () => dir })
    assert.equal(sent[1][0], 'e1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyEdits: a write to a held file carries the version it was computed on, and a refusal says why', async () => {
  const dir = tmp()
  try {
    const file = join(dir, 'pcb.tsx')
    writeFileSync(file, 'one\n')
    const edits = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: '1' }]
    // the holder's buffer is at version 7: an edit computed on 7 goes in, one on 6 is refused as vscode-languageclient refuses it
    const sent = []
    const editor = {
      holder: { id: 'e1', role: 'editor' },
      initialized: true,
      applyEdit: async e => (sent.push(e), !e.documentChanges || e.documentChanges[0].textDocument.version === 7),
    }
    const hub = { servers: () => [{ key: 'k', server: editor }], store: () => ({ holderOf: () => ({ id: 'e1', role: 'editor' }) }) }
    const o = { hub, root: dir, projectOf: () => dir }
    assert.deepEqual(await applyEdits([{ file, edits, against: { holder: 'e1', version: 7 } }], o), [{ file, via: 'editor', applied: true }])
    assert.deepEqual(sent[0], { documentChanges: [{ textDocument: { uri: `file://${file}`, version: 7 }, edits }] })
    assert.deepEqual(await applyEdits([{ file, edits, against: { holder: 'e1', version: 6 } }], o), [
      { file, via: 'editor', applied: false, reason: 'pcb.tsx changed in the editor while the edit was made; nothing was written there' },
    ])
    // a version of another connection's text says nothing of this editor's buffer: the plain form
    await applyEdits([{ file, edits, against: { holder: 'a1', version: 3 } }], o)
    assert.deepEqual(Object.keys(sent[2]), ['changes'])
    assert.equal(readFileSync(file, 'utf8'), 'one\n', 'disk untouched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pointMap: lines matched across an edit, a renamed name moves nothing around it, the edit itself has no image', () => {
  const a = 'const TP2 = T()\nx\n<TP2 at="1 2" />\n'
  const b = 'import y\nconst TPX = T()\nx\n<TPX at="1 2" />\n'
  const m = pointMap(a, b)
  assert.deepEqual(m([1, 13]), [2, 13], 'the call after the rename on its line')
  assert.deepEqual(m([3, 1]), [4, 1], 'the element start before the rename')
  assert.deepEqual(m([3, 17]), [4, 17], 'its end after it')
  assert.equal(pointMap('const ABC = 1', 'const XYZ = 1')([1, 8]), null, 'inside the renamed name')
  assert.deepEqual(m([2, 1]), [3, 1])
})

test('snapshots: an id names the run that committed it, runs count across projects, the same inputs keep the previous, staleness from stamps and unsaved text', () => {
  const dir = tmp()
  try {
    const f = join(dir, 'pcb.tsx')
    writeFileSync(f, 'a')
    const st = new Map([[f, 'x']])
    const s = snapshots('sess')
    const stamps = () => new Map([[f, readStamp(f)]])
    const one = s.commit({ project: dir, slots: [], stamps: stamps(), overlay: new Map(), texts: new Map() })
    assert.deepEqual([one.id, one.run], ['sess.1', 1])
    s.commit({ project: '/other', slots: [], stamps: st, overlay: new Map(), texts: new Map() })
    writeFileSync(f, 'bb')
    const two = s.commit({ project: dir, slots: [], stamps: stamps(), overlay: new Map(), texts: new Map() })
    assert.equal(two.id, 'sess.3')
    assert.equal(s.previous(dir), one)
    const again = s.commit({ project: dir, slots: [], stamps: stamps(), overlay: new Map(), texts: new Map() })
    assert.equal(s.current(dir), again)
    assert.equal(s.previous(dir), one, 'a compile of the same inputs keeps the previous')
    assert.equal(s.get('sess.1'), one)
    const now = { overlay: () => null, pending: false }
    assert.equal(staleOf(again, now), null)
    assert.deepEqual(staleOf(again, { ...now, pending: true }), { reason: 'compiling' })
    assert.deepEqual(staleOf(null, now), { reason: 'changed' })
    assert.deepEqual(changedFiles(again, { overlay: () => 'h' }), [f], 'unsaved text the snapshot did not compile')
    writeFileSync(f, 'ccc')
    assert.deepEqual(staleOf(again, now), { reason: 'changed' })
    const e = envelope({ ...again, overlay: new Map([[f, 'h']]) }, null, 1)
    assert.deepEqual(e, { snapshot: again.id, stale: null, overlay: ['pcb.tsx'], value: 1 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const readStamp = f => {
  const { size, mtimeMs } = statSync(f)
  return `${size}:${mtimeMs}`
}

test('the events log: gapless ids, a cursor of another session, of the old form or below the floor resets', () => {
  const log = eventLog('s1')
  assert.deepEqual(log.since(null), { events: [], next: 's1:0' })
  const a = log.push('edit', '/p', { file: 'a.tsx', source: 'disk', ranges: null, shadowed: true })
  log.push('save', '/p', { file: 'a.tsx' })
  assert.equal(a.id, 's1:1')
  assert.deepEqual(
    log.since('s1:1').events.map(e => e.id),
    ['s1:2'],
  )
  assert.equal(log.since('s1:1').next, 's1:2')
  assert.equal(log.since('s0:1').reset, 'another session')
  assert.equal(log.since('s1.1').reset, 'another session', 'a snapshot id is no cursor')
})

test('typecheck with an overlay: the unsaved text counts, and the cache is neither read nor written', () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }))
    writeFileSync(join(dir, 'main.ts'), 'export const n: number = 1\n')
    const main = join(dir, 'main.ts')
    const over = typecheck(dir, ['main.ts'], { overlay: f => (f === main ? "export const n: number = 'x'\n" : undefined) })
    assert.equal(over.errors.length, 1)
    assert.equal(over.cached, false)
    assert.ok(!existsSync(join(dir, '.pcbjs', 'typecheck.json')))
    const disk = typecheck(dir, ['main.ts'])
    assert.deepEqual(disk.errors, [])
    assert.ok(existsSync(join(dir, '.pcbjs', 'typecheck.json')))
    const again = typecheck(dir, ['main.ts'], { overlay: () => undefined })
    assert.equal(again.cached, false, 'an overlaid run never answers from the cache')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

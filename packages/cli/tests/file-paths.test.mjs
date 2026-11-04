import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileKey, sameFile, sourcePath, under } from '../dist/project/files.js'
import { entriesReaching, focusTarget } from '../dist/project/boards.js'
import { modulesFor } from '../dist/project/loader.js'
import { scopeOf } from '../dist/session/scopes.js'
import { mirrorGraph } from '../dist/session/worker-client.js'
import { previewable } from '../dist/session/plugin.js'
import { ideBridge } from '../dist/server/bridge.js'

test('Windows editor, watcher and Vite spellings reach the same entry and deepest scope', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    const root = 'c:\\dev\\pcb',
      entry = `${root}\\pcb.tsx`,
      shared = 'C:/dev/pcb/lib/pinout.ts'
    const graph = mirrorGraph([
      ['C:/dev/pcb/pcb.tsx', [shared]],
      [shared, []],
    ])
    assert.deepEqual([...entriesReaching(graph.getModulesByFile('c:\\dev\\pcb\\lib\\pinout.ts'), [entry])], [entry])
    assert.ok(graph.imported(entry).has(shared))
    const slots = [{ entry: { file: entry, rel: 'pcb.tsx' }, compiled: [{ board: { name: 'Clock' } }] }]
    assert.equal(focusTarget(graph, slots, shared).board, 'Clock')
    assert.equal(focusTarget(undefined, slots, 'C:/dev/pcb/PCB.tsx').board, 'Clock')
    const scopes = [{ dir: root }, { dir: `${root}\\lib` }]
    assert.equal(scopeOf(scopes, shared), scopes[1])
    assert.equal(scopeOf(scopes, 'C:/dev/pcb-other/file.ts'), null)
    assert.ok(previewable(root, shared))
    assert.equal(previewable(root, 'C:\\dev\\pcb\\node_modules\\lib\\file.ts'), false)
    assert.equal(previewable(root, 'C:\\dev\\pcb\\.pcbjs\\file.ts'), false)
    assert.equal(sourcePath(root, shared), 'lib/pinout.ts')
    assert.equal(sourcePath(root, 'c:\\dev\\pcb\\pcb.tsx'), 'pcb.tsx')
    assert.equal(sourcePath(root, 'C:/dev/pcb-other/file.ts'), 'C:/dev/pcb-other/file.ts')
    assert.ok(under('C:/dev/pcb/pcb.tsx', 'c:\\dev\\pcb\\'))
    assert.ok(sameFile('C:/dev/pcb/pcb.tsx', entry))
    const nodes = new Set([{ file: shared }])
    const vite = { getModulesByFile: () => undefined, fileToModulesMap: new Map([[shared, nodes]]) }
    assert.equal(modulesFor(vite, 'c:\\dev\\pcb\\lib\\pinout.ts'), nodes)
    assert.ok(under('\\\\SERVER\\Share\\pcb.tsx', '//server/share/'))
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
})

test('POSIX identity preserves case and literal backslashes', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'linux' })
  try {
    assert.equal(sameFile('/p/PCB.tsx', '/p/pcb.tsx'), false)
    assert.equal(fileKey('/p/a\\b.ts'), '/p/a\\b.ts')
    assert.equal(under('/pcb-other/a.ts', '/pcb'), false)
    assert.ok(under('/pcb/a.ts', '/'))
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
})

test('editor bridge accepts native paths under Vite allow roots, but refuses adjacent folders', async () => {
  const top = mkdtempSync(join(tmpdir(), 'pcbjs-open-'))
  const file = join(top, 'pcb.tsx')
  writeFileSync(file, '')
  const spelling = p => (process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p)
  const selected = []
  const server = { config: { server: { fs: { allow: [spelling(top)] } } } }
  const bridge = ideBridge(server, () => `${top}-other`, { lsp: { keys: () => ['editor'], select: (_key, ranges) => selected.push(...ranges) } })
  const request = async path => {
    const response = { statusCode: 200, setHeader() {}, end() {} }
    await bridge.middleware({ url: `/__pcbjs/open?file=${encodeURIComponent(path)}` }, response, () => assert.fail('unhandled request'))
    return response.statusCode
  }
  try {
    assert.equal(await request(file), 204)
    assert.equal(selected.length, 1)
    server.config.server.fs.allow = [spelling(`${top}-prefix`)]
    assert.equal(await request(file), 404)
    assert.equal(selected.length, 1)
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

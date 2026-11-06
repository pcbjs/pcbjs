import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileKey, sameFile, sourcePath, under } from '../dist/project/files.js'
import { entriesReaching, focusTarget } from '../dist/project/boards.js'
import { modulesFor, viteLoader } from '../dist/project/loader.js'
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
    await bridge.middleware({ url: `/__pcbjs/open?file=${encodeURIComponent(path)}`, headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } }, response, () =>
      assert.fail('unhandled request'),
    )
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

test('Windows source frames use the module graph identity before Vite maps generated positions', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    const id = 'C:/Users/Dev/board/pcb.tsx'
    const node = { id, file: id }
    const graph = {
      getModuleById: file => (file === id ? node : undefined),
      getModulesByFile: file => (file === id ? new Set([node]) : undefined),
      fileToModulesMap: new Map([[id, new Set([node])]]),
    }
    const loader = viteLoader({
      environments: { ssr: { moduleGraph: graph } },
      ssrFixStacktrace: error => {
        if (error.stack.includes(`${id}:62:12`)) error.stack = `Error\n    at f (${id}:16:3)`
      },
    })
    for (const file of ['c:\\users\\dev\\board\\pcb.tsx', 'c:/users/dev/board/pcb.tsx', id]) {
      assert.deepEqual(loader.mapSrc({ file, line: 62, col: 12 }), { file: id, line: 16, col: 3 })
    }
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
})

test('Vite maps real TSX stack frames, route steps and helper callers to original source positions', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-source-map-')))
  const file = join(root, 'pcb.tsx')
  const code = `import PCB, { nets, route } from '@pcbjs/core'
const { SIG } = nets()
export const raw = new Error('source frame').stack
const manual = route('5 5').net(SIG).width(0.01)
  .H(10)
const inline = [8].map(y => route([5, y]).net(SIG).H(10))
const wire = (y: number) => route([5, y]).net(SIG).H(10)
export default (
  <PCB name="SourceMap">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={20} />
    {manual}
    {inline}
    {wire(10)}
    {route('5 12').net(SIG).H(10)}
  </PCB>
)
`
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(join(root, 'pcb.config.ts'), "export default { entries: ['pcb.tsx'] }")
    writeFileSync(file, code)
    mkdirSync(join(root, 'node_modules'))
    symlinkSync(new URL('../../../node_modules/@pcbjs', import.meta.url), join(root, 'node_modules/@pcbjs'), 'dir')
    const child = join(root, 'node_modules/source-map-check.mjs')
    writeFileSync(
      child,
      `
      import { resolveConfig } from ${JSON.stringify(new URL('../dist/project/config.js', import.meta.url).href)};
      import { compileServer } from ${JSON.stringify(new URL('../dist/project/compile.js', import.meta.url).href)};
      import { viteLoader } from ${JSON.stringify(new URL('../dist/project/loader.js', import.meta.url).href)};
      import { evaluateEntry } from '@pcbjs/compile/internal/entry';
      import { compileBoard } from '@pcbjs/compile';
      import { localFrames } from '@pcbjs/core/internal/provenance';
      const root=process.cwd(),file=${JSON.stringify(file)};
      const cfg=await resolveConfig([], 'build', undefined, root),server=await compileServer(cfg);
      try {
        const loader=viteLoader(server),evaluated=await evaluateEntry(loader,{file,rel:'pcb.tsx'}),mod=await loader.load(file);
        const raw=localFrames(mod.raw).find(f=>/[\\\\/]pcb\\.tsx$/.test(f.file));
        const node=[...server.environments.ssr.moduleGraph.idToModuleMap.values()].find(m=>m.file?.replaceAll('\\\\','/').toLowerCase()===file.replaceAll('\\\\','/').toLowerCase());
        const mapped=raw&&loader.mapSrc(raw);
        const alias=process.platform==='win32'&&raw?loader.mapSrc({...raw,file:raw.file.toLowerCase().replaceAll('/','\\\\')}):mapped;
        const board=compileBoard(evaluated.root,{cache:false,files:loader.imported(file),sourceRoot:root});
        console.log(JSON.stringify({raw,mapped,alias,id:node?.id,file:node?.file,sources:node?.transformResult?.map?.sources,rawStack:mod.raw,tracks:board.items.filter(i=>i.kind==='track').map(i=>({src:i.src,chain:i.chain}))}));
      } finally {await server.close()}
    `,
    )
    const run = spawnSync(process.execPath, [child], { cwd: root, encoding: 'utf8', timeout: 30000 })
    assert.equal(run.status, 0, run.stderr)
    const { raw, mapped, alias, tracks, ...diagnostic } = JSON.parse(run.stdout.trim())
    assert.ok(raw, diagnostic.rawStack)
    const detail = JSON.stringify({ raw, mapped, ...diagnostic })
    t.diagnostic(detail)
    assert.equal(mapped.line, 3, detail)
    assert.equal(mapped.col, code.split('\n')[2].indexOf('new Error') + 1, detail)
    assert.deepEqual(alias, mapped, detail)
    assert.deepEqual(
      tracks.map(i => i.src?.line),
      [5, 6, 7, 14],
      JSON.stringify(tracks.map(i => ({ src: i.src, chain: i.chain }))),
    )
    assert.equal(tracks[0].src.col, code.split('\n')[4].indexOf('.H') + 2)
    for (const item of tracks.slice(0, 2)) assert.ok(!item.chain?.some(s => s.call && /[\\/]?pcb\.tsx$/.test(s.file)), JSON.stringify(item.chain))
    assert.ok(!tracks[3].chain?.some(s => s.call), JSON.stringify(tracks[3].chain))
    const caller = tracks[2].chain?.findLast(s => s.call)
    assert.equal(caller?.line, 13, JSON.stringify(caller))
    assert.equal(caller?.col, code.split('\n')[12].indexOf('wire') + 1, JSON.stringify(caller))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

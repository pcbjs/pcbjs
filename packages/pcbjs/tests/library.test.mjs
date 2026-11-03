// Library mode on examples/library: power built with `pcbjs build --lib`, installed into the consumer, whose board places the library's
// circuit and references its board by package; compose() of the two boards places the module where reference() does. A module making
// a part when it loads is refused, and reference data of another format names the package to rebuild.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compose, readGlb } from '@pcbjs/export/compose'

const REPO = join(import.meta.dirname, '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const root = realpathSync(mkdtempSync(join(REPO, 'examples', '.tmp-library-')))
after(() => rmSync(root, { recursive: true, force: true }))
cpSync(join(REPO, 'examples', 'library'), root, { recursive: true, filter: s => !/[\\/](node_modules|dist|\.pcbjs)$/.test(s) })
const power = join(root, 'power')
const consumer = join(root, 'consumer')
const pkg = join(consumer, 'node_modules', '@pcbjs-examples', 'power')

const pcbjs = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const install = () => {
  rmSync(pkg, { recursive: true, force: true })
  mkdirSync(join(pkg, '..'), { recursive: true })
  cpSync(join(power, 'dist'), pkg, { recursive: true })
}

test('build --lib writes the package: modules with their names captured, types, every board as data', { timeout: 240000 }, () => {
  const r = pcbjs(power, 'build', '--lib')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /lib {4}dist {2}@pcbjs-examples\/power@0\.1\.0 {2}2 modules, 1 board/)
  const dist = join(power, 'dist')
  const p = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'))
  assert.equal(p.name, '@pcbjs-examples/power')
  assert.deepEqual(Object.keys(p.exports), ['.', './ldo', './boards/PowerModule', './pcbjs.json', './package.json'])
  assert.deepEqual(p.exports['./boards/PowerModule'], {
    types: './boards/PowerModule/index.d.ts',
    pcbjs: './boards/PowerModule/reference.json',
    default: './boards/PowerModule/index.js',
  })
  assert.match(p.peerDependencies['@pcbjs/core'], /^>=0\.\d+\.0-0 <0\.\d+\.0$/)
  assert.ok(p.peerDependencies['@pcbjs/lib'], 'the packages the modules import are peers')
  for (const f of ['index.js', 'index.d.ts', 'ldo.js', 'ldo.d.ts', 'pcbjs.json']) assert.ok(existsSync(join(dist, f)), f)
  const chunks = readFileSync(join(dist, 'ldo.js'), 'utf8') + readFileSync(join(dist, readFileSync(join(dist, 'ldo.js'), 'utf8').match(/\.\/(chunks\/[\w-]+\.js)/)[1]), 'utf8')
  assert.match(chunks, /Symbol\.for\("pcbjs\.bindRef"\)\][^]*"LdoBlock"/, 'the binding names baked in')
  assert.match(readFileSync(join(dist, 'ldo.d.ts'), 'utf8'), /export declare const ldo: /)
  const board = join(dist, 'boards', 'PowerModule')
  for (const f of ['meta', 'sch', 'layers', 'model', 'findings', 'fab']) assert.ok(existsSync(join(board, `${f}.json`)), f)
  for (const f of ['reference.json', 'mesh.bin', 'model.glb', '2d.svg', 'sch.svg', 'index.js', 'index.d.ts']) assert.ok(existsSync(join(board, f)), f)
  const ref = JSON.parse(readFileSync(join(board, 'reference.json'), 'utf8'))
  assert.equal(ref.name, 'PowerModule')
  assert.equal(ref.entry, '@pcbjs-examples/power/boards/PowerModule')
  assert.deepEqual(ref.files, [], 'no path of the build machine')
  assert.deepEqual(JSON.parse(readFileSync(join(dist, 'pcbjs.json'), 'utf8')).format, 1)
})

let placed = null

test('a consumer places the library circuit and references its board by package, clean', { timeout: 240000 }, () => {
  install()
  const r = pcbjs(consumer, 'check')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Carrier 0\.1\.0 .* DRC ok {2}ERC ok/)
  const parts = pcbjs(consumer, 'inspect', 'U201')
  assert.match(parts.out, /U201 \(ldo2\/U01\) {2}AMS1117-3\.3/, 'instance 2 of the library circuit')
  const refs = pcbjs(consumer, 'inspect', '--references', '--json')
  const json = JSON.parse(refs.out.slice(refs.out.indexOf('{'), refs.out.lastIndexOf('}') + 1))
  assert.equal(json.references[0].name, 'PowerModule')
  assert.equal(json.references[0].anchor.local, 'J2/1')
  placed = json.references[0].transform
})

test('compose() places the module where reference() does, from a folder or the board its index exports', { timeout: 240000 }, async t => {
  if (!placed) return t.skip('the consumer did not compile')
  writeFileSync(join(consumer, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], lib: { exports: {} } })\n")
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'carrier', version: '0.1.0', type: 'module' }))
  const r = pcbjs(consumer, 'build', '--lib')
  assert.equal(r.code, 0, r.out)
  const carrier = join(consumer, 'dist', 'boards', 'Carrier')
  const { board } = await import(pathToFileURL(join(pkg, 'boards', 'PowerModule', 'index.js')).href)
  for (const module of [join(pkg, 'boards', 'PowerModule'), board]) {
    const glb = await compose([{ board: carrier }, { board: module, mate: { local: 'J2', remote: 'J1', pin: 1 } }], { format: 'glb' })
    const { json, bin } = readGlb(glb)
    assert.deepEqual(
      json.scenes[0].nodes.map(n => json.nodes[n].name),
      ['board:Carrier', 'board:PowerModule'],
    )
    const m = json.nodes.find(n => n.name === 'board:PowerModule').matrix
    // back from the GLB's metres with y up to the 3D view's mm: (x, y, z) is (x, -z, y) / 1000 there
    const C = [1e-3, 0, 0, 0, 0, 0, -1e-3, 0, 0, 1e-3, 0, 0, 0, 0, 0, 1]
    const Cinv = [1e3, 0, 0, 0, 0, 0, 1e3, 0, 0, -1e3, 0, 0, 0, 0, 0, 1]
    const mul = (a, b) => Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((s, k) => s + a[k * 4 + (i % 4)] * b[Math.floor(i / 4) * 4 + k], 0))
    const back = mul(mul(Cinv, m), C)
    back.forEach((v, i) => assert.ok(Math.abs(v - placed[i]) < 1e-6, `matrix[${i}] ${v} against ${placed[i]}`))
    assert.ok(bin.byteLength > readGlb(readFileSync(join(carrier, 'model.glb'))).bin.byteLength, 'both boards in one binary')
  }
})

test('build --lib refuses a module that makes a part when it loads', { timeout: 240000 }, () => {
  const dir = join(root, 'bad')
  mkdirSync(dir)
  writeFileSync(join(dir, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: [], lib: { exports: { '.': './parts.ts' } } })\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'bad', version: '1.0.0', type: 'module' }))
  writeFileSync(join(dir, 'parts.ts'), "import { R0603 } from '@pcbjs/lib'\nexport const R7 = R0603('1k')\n")
  const r = pcbjs(dir, 'build', '--lib')
  assert.notEqual(r.code, 0)
  assert.match(r.out, /parts\.ts makes R7 at parts\.ts:2 when it loads: a library module exports factories and circuits/)
})

test('reference data of another format names the package to rebuild', { timeout: 240000 }, () => {
  install()
  writeFileSync(join(consumer, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  const file = join(pkg, 'boards', 'PowerModule', 'reference.json')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), format: 1 }))
  const r = pcbjs(consumer, 'check')
  assert.equal(r.code, 1)
  assert.match(r.out, /reference data of format 1, this pcbjs reads \d+: rebuild @pcbjs-examples\/power with pcbjs build --lib/)
})

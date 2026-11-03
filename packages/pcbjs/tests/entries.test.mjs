// The stable entry points: scripts/check-entries.mjs on the repository and on a small tree with every kind of fault, and the imports of
// the owner's ported repositories, read only, resolved against the entries the packages list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const repo = join(import.meta.dirname, '../../..')
const { checkEntries, cliLayers, packageEntries } = await import(join(repo, 'scripts/check-entries.mjs'))

const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
const pkg = (name, exports) => JSON.stringify({ name: `@pcbjs/${name}`, exports })

test('entries: the repository imports only listed entries and lists no wildcard', () => {
  assert.deepEqual(checkEntries(repo), [])
  for (const [name, p] of packageEntries(repo)) assert.ok(!p.keys.some(k => k.includes('*')), `@pcbjs/${name} lists a wildcard`)
})

test('entries: an unlisted import, an internal entry in a doc, a wildcard and an internal entry nobody imports are each named', () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-entries-'))
  try {
    put(
      root,
      'packages/a/package.json',
      pkg('a', { '.': './dist/index.js', './internal/geom': './dist/geom.js', './internal/spare': './dist/spare.js', './package.json': './package.json' }),
    )
    put(root, 'packages/b/package.json', pkg('b', { '.': './dist/index.js', './*': './dist/*.js' }))
    put(root, 'packages/b/src/index.ts', "import { geom } from '@pcbjs/a/internal/geom'\nimport { cut } from '@pcbjs/a/cut'\nexport { geom, cut }\n")
    put(root, 'docs/x.md', "# X\n\n```ts\nimport { geom } from '@pcbjs/a/internal/geom'\n```\n")
    const problems = checkEntries(root)
    const has = re =>
      assert.ok(
        problems.some(p => re.test(p)),
        `no problem matches ${re}:\n${problems.join('\n')}`,
      )
    has(/^packages\/b\/src\/index\.ts:2: @pcbjs\/a\/cut is no entry of @pcbjs\/a/)
    has(/^docs\/x\.md:4: @pcbjs\/a\/internal\/geom is internal/)
    has(/^packages\/b\/package\.json: the wildcard entry \.\/\*/)
    has(/^packages\/a\/package\.json: \.\/internal\/spare has no importer outside @pcbjs\/a/)
    assert.ok(!problems.some(p => /internal\/geom has no importer/.test(p)), 'b imports internal/geom')
    assert.equal(problems.length, 4)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('entries: a cli layer importing a command or a later layer is named, a command importing any layer is not', () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-layers-'))
  try {
    put(root, 'packages/cli/src/project/a.ts', "import { b } from './b.js'\nimport { run } from '../cli.js'\nexport const a = b + run\n")
    put(root, 'packages/cli/src/project/b.ts', 'export const b = 1\n')
    put(root, 'packages/cli/src/render/r.ts', "import type { S } from '../session/s.js'\nimport { a } from '../project/a.js'\nexport const r = (s: S) => a\n")
    put(root, 'packages/cli/src/session/s.ts', "import { r } from '../render/r.js'\nexport type S = typeof r\n")
    put(root, 'packages/cli/src/cli.ts', "import { s } from './session/s.js'\nexport const run = 1\n")
    assert.deepEqual(cliLayers(root), [
      'packages/cli/src/project/a.ts:2: project/ imports cli.js, a command; project/ imports project/ only',
      'packages/cli/src/render/r.ts:1: render/ imports session/s.js, a session/ module; render/ imports render/, project/ only',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// the owner's ports, linked to this checkout by file: dependencies; absent on CI
const PORTED = [
  '/Users/yuxuan/Lab/MirrorLinkPCB-pcbjs',
  '/Users/yuxuan/Lab/FoveaCamPCB/DuoController-pcbjs/pcbjs',
  '/Users/yuxuan/playground/HiroseAdapter-pcbjs',
  '/Users/yuxuan/playground/SmartStrip-pcbjs/pcbjs',
]
const SKIP = new Set(['node_modules', '.pcbjs', '.git', 'dist'])
function sources(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const f = join(dir, e.name)
    if (e.isDirectory()) sources(f, out)
    else if (/\.(tsx?|mts|mjs|js)$/.test(e.name)) out.push(f)
  }
  return out
}

test('entries: every @pcbjs import of the ported repositories names a listed entry of a package they depend on', t => {
  const here = PORTED.filter(d => existsSync(join(d, 'package.json')))
  if (!here.length) return t.skip('none of the ported repositories is on this machine')
  const entries = packageEntries(repo)
  for (const dir of here) {
    const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const deps = new Set(Object.keys({ ...p.dependencies, ...p.devDependencies }))
    const bad = []
    for (const f of sources(dir))
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](@pcbjs\/([a-z-]+)(\/[^'"]+)?)['"]/g)) {
        const [, spec, name, sub] = m
        const key = sub ? `.${sub}` : '.'
        if (!deps.has(`@pcbjs/${name}`)) bad.push(`${f}: ${spec}, a package it does not depend on`)
        else if (!entries.get(name)?.keys.includes(key) || key.startsWith('./internal/')) bad.push(`${f}: ${spec}`)
      }
    assert.deepEqual(bad, [], dir)
  }
})

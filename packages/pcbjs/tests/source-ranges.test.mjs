import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { transform } from 'esbuild'
import { transformSourceRanges, wantsSourceRanges } from '@pcbjs/cli/internal/source-ranges'
import { normalizeRepoUrl, repoKind, resolveRepo } from '@pcbjs/cli/internal/repo'
// the transform's text hashes, which tests/source-ranges.test.mjs checks, left out of the literals compared here
const plain = s => s.replace(/, hash: "[0-9a-f]{12}"/g, '')

const fixture = `import PCB, { route, via } from '@pcbjs/core'
const at = '1mm 1mm'
export default (
  <PCB name="T">
    <path layer="Edge.Cuts" d="M 0 0 H 10" />
    {route('1 1').net(GND).h(4)}
    {via(GND, at)}
    <text at="1mm 2mm">hi</text>
  </PCB>
)
`
const run = (code = fixture, id = '/p/main.tsx', file = 'main.tsx') => {
  const r = transformSourceRanges(code, id, file)
  return r && { ...r, code: plain(r.code) }
}
const src = (file, line, col, endLine, endCol) => `{ file: ${JSON.stringify(file)}, line: ${line}, col: ${col}, endLine: ${endLine}, endCol: ${endCol} }`
// the `__src` objects of the output, in source order
const srcs = code => [...code.matchAll(/\{ file: "([^"]+)", line: (\d+), col: (\d+), endLine: (\d+), endCol: (\d+) \}/g)].map(m => [m[1], ...m.slice(2).map(Number)])

test('source ranges: a self-closing element gets __src as its last attribute', () => {
  const { code } = run()
  assert.ok(code.includes(`<path layer="Edge.Cuts" d="M 0 0 H 10" __src={${src('main.tsx', 5, 5, 5, 45)}} />`))
})

test('source ranges: an element with children ends at the last character of its closing tag', () => {
  const { code } = run()
  assert.ok(code.includes(`<PCB name="T" __src={${src('main.tsx', 4, 3, 9, 8)}}>`))
  assert.ok(code.includes(`<text at="1mm 2mm" __src={${src('main.tsx', 8, 5, 8, 32)}}>hi</text>`))
})

test('source ranges: route(a) gets __src as an argument of its own, and each chain command its own range', () => {
  const { code } = run()
  assert.ok(code.includes(`route('1 1', { __src: ${src('main.tsx', 6, 6, 6, 17)} }).net(GND).h(4).__at(${src('main.tsx', 6, 28, 6, 31)})`), code)
})

test('source ranges: via(net, someVar) gets __src as an argument of its own, never wrapping the position', () => {
  const { code } = run()
  assert.ok(code.includes(`via(GND, at, { __src: ${src('main.tsx', 7, 6, 7, 17)} })`), code)
})

test('source ranges: positions are 1-based and point at the element text', () => {
  const { code } = run()
  const lines = fixture.split('\n')
  for (const [, line, col, endLine, endCol] of srcs(code)) {
    assert.match(lines[line - 1][col - 1], /[<a-z]/)
    assert.match(lines[endLine - 1][endCol - 1], /[>)]/)
  }
  assert.equal(srcs(code).length, 6)
})

test('source ranges: renamed and namespace imports, trailing commas, empty objects, other callees', () => {
  const code = `import * as pcb from '@pcbjs/core'
import { pour as p } from '@pcbjs/core'
import { route } from './elsewhere'
pcb.route({ net: 'A', })
p({})
route({ net: 'B' })
pcb.via()
`
  const out = plain(transformSourceRanges(code, '/p/a.ts', 'a.ts').code)
  assert.ok(out.includes(`pcb.route({ net: 'A', __src: ${src('a.ts', 4, 1, 4, 24)}, })`))
  assert.ok(out.includes(`p({ __src: ${src('a.ts', 5, 1, 5, 5)} })`))
  assert.ok(out.includes(`route({ net: 'B' })`), 'route from another module is left alone')
  assert.ok(out.includes('pcb.via()'))
})

test('source ranges: a route or via call carries the lines of the helper around it, skipping callbacks; inline calls have none', () => {
  const code = [
    "import { route, via } from '@pcbjs/core'",
    'function rows(xs: number[]) {',
    '  return xs.map(x => route(`${x} 0`, `${x} 5`).Z())',
    '}',
    'const drop = (at: string) => via(GND, at)',
    'export const all = [0, 1].map(i => route(`${i} 0`, `${i} 1`).Z())',
  ].join('\n')
  const out = plain(transformSourceRanges(code, '/p/a.ts', 'a.ts').code)
  const srcs = [...out.matchAll(/__src: (\{ file[^}]*\}(?:, fn: \{[^}]*\})? \})/g)].map(m => m[1])
  assert.equal(srcs.length, 3)
  assert.match(srcs[0], /line: 3, .*fn: \{ line: 2, endLine: 4 \}/)
  assert.match(srcs[1], /line: 5, .*fn: \{ line: 5, endLine: 5 \}/)
  assert.doesNotMatch(srcs[2], /fn:/)
})

test('source ranges: a wire() chain gets the range of the whole chain as an argument of its own', () => {
  const code = `import { wire } from '@pcbjs/core'\nconst w = [\n  wire(J1[3]).h(2)\n    .Z(Q1[1]),\n  wire('4 7').V(3),\n]\n`
  const out = run(code).code
  assert.ok(out.includes(`wire(J1[3], { __src: ${src('main.tsx', 3, 3, 4, 13)} }).h(2)`))
  assert.ok(out.includes(`wire('4 7', { __src: ${src('main.tsx', 5, 3, 5, 18)} }).V(3)`))
})

test('source ranges: a module with no pcbjs import, no JSX and no binding is left alone; a binding is captured, it may hold a part', () => {
  assert.equal(run(`export function f(x: number) { return x }\n`, '/p/util.ts', 'util.ts'), null)
  assert.match(run(`export const a = make()\n`, '/p/util.ts', 'util.ts').code, /f\(v, "a", \{ file: "util\.ts", line: 1, col: 14 \}, false\)/)
  assert.equal(run(`import { route } from 'other'\nroute({ a: 1 })\n`, '/p/x.ts', 'x.ts'), null)
})

test('source ranges: which ids the plugin transforms', () => {
  assert.ok(wantsSourceRanges('/p/main.tsx', '/p'))
  assert.ok(wantsSourceRanges('/p/lib/part.ts?v=1', '/p'))
  assert.ok(!wantsSourceRanges('/p/node_modules/x/a.tsx', '/p'))
  assert.ok(!wantsSourceRanges('/p/.pcbjs/cache/a.tsx', '/p'))
  assert.ok(!wantsSourceRanges('/q/a.tsx', '/p'))
  assert.ok(!wantsSourceRanges('/p/a.d.ts', '/p'))
  assert.ok(!wantsSourceRanges('/p/a.js', '/p'))
  assert.ok(!wantsSourceRanges('/p/client/a.ts', '/p', ['/p/client']))
})

test('source ranges: the output still compiles with the automatic JSX runtime, and carries a source map', async () => {
  const r = run()
  const out = await transform(r.code, { loader: 'tsx', jsx: 'automatic', jsxImportSource: '@pcbjs/core' })
  assert.match(out.code, /__src: \{ file: "main\.tsx", line: 5, col: 5, endLine: 5, endCol: 45 \}/)
  assert.equal(r.map.sources[0], '/p/main.tsx')
  assert.ok(r.map.mappings.length > 0)
})

const git = answers => args => answers[args.join(' ')] ?? null

test('repo: kind inferred from the host', () => {
  assert.equal(repoKind('https://github.com/org/x'), 'github')
  assert.equal(repoKind('https://gitlab.com/org/x'), 'gitlab')
  assert.equal(repoKind('https://git.example.com/group/x/-/tree/main'), 'gitlab')
  assert.equal(repoKind('https://gitea.example.com/org/x'), 'gitea')
  assert.equal(repoKind('https://bitbucket.org/org/x'), 'bitbucket')
  assert.equal(repoKind('https://example.com/src/x'), 'generic')
  const r = resolveRepo({ url: 'https://git.example.com/group/x/-/tree/main' }, '/p', git({}))
  assert.deepEqual(r, { url: 'https://git.example.com/group/x', kind: 'gitlab', ref: 'main', dir: '' })
})

test('repo: URLs normalised', () => {
  assert.equal(normalizeRepoUrl('git@github.com:org/x.git'), 'https://github.com/org/x')
  assert.equal(normalizeRepoUrl('https://github.com/org/x/'), 'https://github.com/org/x')
  assert.equal(resolveRepo({ url: 'git@gitlab.com:org/x.git' }, '/p', git({})).kind, 'gitlab')
})

test('repo: ref and dir from the options win over git', () => {
  const g = git({ 'rev-parse --abbrev-ref HEAD': 'dev', 'rev-parse --show-prefix': 'hw/board/' })
  assert.deepEqual(resolveRepo({ url: 'https://github.com/o/x', ref: 'v1.0', dir: './boards/a' }, '/p', g), {
    url: 'https://github.com/o/x',
    kind: 'github',
    ref: 'v1.0',
    dir: 'boards/a/',
  })
  assert.deepEqual(resolveRepo({ url: 'https://example.com/x', kind: 'gitea', dir: '' }, '/p', g), { url: 'https://example.com/x', kind: 'gitea', ref: 'dev', dir: '' })
})

test('repo: ref from git is the branch, else the sha, else main; dir from the work tree prefix', () => {
  const sha = 'a'.repeat(40)
  assert.deepEqual(resolveRepo({ url: 'https://github.com/o/x' }, '/p', git({ 'rev-parse --abbrev-ref HEAD': 'feat', 'rev-parse --show-prefix': 'hw/' })), {
    url: 'https://github.com/o/x',
    kind: 'github',
    ref: 'feat',
    dir: 'hw/',
  })
  assert.equal(resolveRepo({ url: 'https://github.com/o/x' }, '/p', git({ 'rev-parse --abbrev-ref HEAD': 'HEAD', 'rev-parse HEAD': sha })).ref, sha)
  assert.equal(resolveRepo({ url: 'https://github.com/o/x' }, '/p', git({})).ref, 'main')
  assert.equal(resolveRepo(undefined, '/p', git({})), undefined)
})

test('source ranges: each range carries 12 hex of the sha1 of its text, the same after a line inserted above', () => {
  const code = "import { route } from '@pcbjs/core'\nroute('1 1', '2 2').net(GND).H(4)\n"
  const hashes = c => [...transformSourceRanges(c, '/p/a.ts', 'a.ts').code.matchAll(/hash: "([0-9a-f]{12})"/g)].map(m => m[1])
  const [call, step] = hashes(code)
  assert.equal(call, createHash('sha1').update("route('1 1', '2 2')").digest('hex').slice(0, 12))
  assert.equal(step, createHash('sha1').update('H(4)').digest('hex').slice(0, 12))
  assert.deepEqual(hashes(`// a comment\n${code}`), [call, step])
  assert.notDeepEqual(hashes(code.replace("'2 2'", "'2 3'")), [call, step])
})

test("source ranges: an element's hash leaves out its own at and side, which a move, turn or flip rewrites, so the uids of what it made stay", () => {
  const hashes = c => [...transformSourceRanges(c, '/p/a.tsx', 'a.tsx').code.matchAll(/hash: "([0-9a-f]{12})"/g)].map(m => m[1])
  const el = (at, side, text = 'HI') => `export default <g>\n  <text layer="F.SilkS" at=${at}${side}>${text}</text>\n</g>\n`
  const [, base] = hashes(el('"3 4"', ''))
  assert.equal(base, createHash('sha1').update('<text layer="F.SilkS">HI</text>').digest('hex').slice(0, 12))
  assert.equal(hashes(el('{[12, 7.5]}', ' side="B"'))[1], base)
  assert.notEqual(hashes(el('"3 4"', '', 'HO'))[1], base)
})

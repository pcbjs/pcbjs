// `pcbjs diff <ref>` in a scratch repository: a moved track and an added part tinted where they are, an unchanged board
// empty, a ref that fails to compile exit 1 with its error.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-diff-')))
const dir = join(root, 'board')
const cache = join(root, 'cache')
after(() => rmSync(root, { recursive: true, force: true }))

const board = (y, extra = false) => `import PCB from '@pcbjs/core'
import { nets, route } from '@pcbjs/core'
const { SIG } = nets()
import { PinHeader } from '@pcbjs/lib'
const J1 = PinHeader(2)()
const J2 = PinHeader(2)()
${extra ? 'const J3 = PinHeader(2)()\n' : ''}export default (
  <PCB name="T">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <J1 at="5 5" />
    <J2 at="20 5" />
    ${extra ? '<J3 at="12 4" />\n    ' : ''}{route(J1[2], J2[2]).net(SIG).width(0.5).V(${y}).H(20).Z()}
  </PCB>
)
`
const git = (...args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
}
function commit(text, msg) {
  writeFileSync(join(dir, 'pcb.tsx'), text)
  git('add', '-A')
  git('commit', '-q', '-m', msg)
}
const run = (...args) => spawnSync(process.execPath, [BIN, 'diff', ...args], { cwd: dir, env: { ...process.env, NO_COLOR: '1', PCBJS_CACHE_DIR: cache }, encoding: 'utf8' })

mkdirSync(join(root, 'node_modules'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
mkdirSync(dir)
writeFileSync(join(root, '.gitignore'), 'node_modules\n.pcbjs\ncache\n')
writeFileSync(join(dir, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
git('init', '-q')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'test')
commit(board(12), 'a')
commit('export default (\n', 'broken')
commit(board(15, true), 'b')

/** The RGB at board mm (x, y) of a PNG in the frame of its diff.json. */
async function colourAt(png, report, x, y) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const [x0, y0] = report.frame.viewBox
  const px = Math.round((x - x0) / report.frame.mmPerPx),
    py = Math.round((y - y0) / report.frame.mmPerPx)
  const i = (py * info.width + px) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}
const near = (got, hex) => [1, 3, 5].every((k, i) => Math.abs(got[i] - parseInt(hex.slice(k, k + 2), 16)) < 30)

test('diff: a moved track amber at its new place, an added part green, the counts in diff.json', { timeout: 300000 }, async () => {
  const r = run('HEAD~2')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const out = join(dir, '.pcbjs', 'diff', 'T')
  assert.match(r.stdout, /^T {2}\+2 -0 ~\d+ {2}findings/m)
  const report = JSON.parse(readFileSync(join(out, 'diff.json'), 'utf8'))
  assert.equal(report.by, 'uid')
  assert.equal(report.counts.added, 2, JSON.stringify(report.items))
  assert.equal(report.counts.removed, 0)
  assert.ok(report.counts.moved >= 1)
  assert.deepEqual(
    report.items.filter(i => i.change === 'added').map(i => i.ref),
    ['J3/1', 'J3/2'],
  )
  assert.ok(report.items.filter(i => i.change === 'moved').every(i => i.kind === 'track' && i.ref.startsWith('route:') && i.was === i.uid))
  const diff = readFileSync(join(out, 'diff.png'))
  const pad = report.items.find(i => i.ref === 'J3/1').at
  assert.ok(near(await colourAt(diff, report, pad[0] + 0.7, pad[1]), '#30a46c'), 'the added pad is green beside its hole')
  assert.ok(near(await colourAt(diff, report, 12, 15), '#f5a524'), 'the moved track is amber at y 15')
  const was = await colourAt(diff, report, 12, 12)
  assert.ok(!near(was, '#f5a524') && !near(was, '#30a46c'), 'the old place is no full tint')
  for (const f of ['before.png', 'after.png']) {
    const m = await sharp(join(out, f)).metadata()
    assert.deepEqual([m.width, m.height], report.frame.size, f)
  }
})

test('diff: an unchanged board gives an empty diff', { timeout: 300000 }, () => {
  const r = run('HEAD')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const report = JSON.parse(readFileSync(join(dir, '.pcbjs', 'diff', 'T', 'diff.json'), 'utf8'))
  assert.deepEqual(report.counts, { added: 0, removed: 0, moved: 0 })
  assert.equal(report.pixels, 0)
  assert.deepEqual(report.items, [])
  assert.match(r.stdout, /^T {2}\+0 -0 ~0 {2}findings \+0 -0/m)
})

test('diff: a ref that fails to compile exits 1 with its error', { timeout: 300000 }, () => {
  const r = run('HEAD~1')
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /^HEAD~1: pcb\.tsx {2}compile error/m)
})

test('diff: a name that is no commit exits 1', { timeout: 60000 }, () => {
  const r = run('no-such-ref')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /^pcbjs diff: no-such-ref is no commit/m)
})

test('diff: the route memos of .pcbjs/cache/route are copied into the other tree', async () => {
  const { shareRoutes } = await import('../dist/diff.js')
  const from = join(root, 'memos-from')
  const to = join(root, 'memos-to')
  mkdirSync(join(from, '.pcbjs', 'cache', 'route'), { recursive: true })
  mkdirSync(to)
  writeFileSync(join(from, '.pcbjs', 'cache', 'route', 'T.json'), '{}')
  shareRoutes(from, to)
  assert.equal(readFileSync(join(to, '.pcbjs', 'cache', 'route', 'T.json'), 'utf8'), '{}')
  shareRoutes(to, join(root, 'missing'))
  assert.ok(!existsSync(join(root, 'missing')))
})

test('diff: without uids items match by geometry, a moved via paired by its route', async () => {
  const { diffItems } = await import('../dist/render/diff-match.js')
  const layers = [
    { id: 'F.Cu', kind: 'copper' },
    { id: 'B.Cu', kind: 'copper' },
  ]
  const via = (id, x) => ({ id, kind: 'via', layer: 'F.Cu', net: 'A', route: 'route:1', at: [x, 0], drill: 0.3, size: 0.6, layers: ['F.Cu', 'B.Cu'] })
  const track = {
    id: 0,
    kind: 'track',
    layer: 'F.Cu',
    net: 'A',
    route: 'route:1',
    pts: [
      [0, 0],
      [5, 0],
    ],
    width: 0.2,
  }
  const d = diffItems({ layers, items: [track, via(1, 5)] }, { layers, items: [track, via(1, 7), via(2, 9)] })
  assert.equal(d.by, 'geometry')
  assert.deepEqual(
    d.items.map(i => [i.change, i.kind, i.at[0]]),
    [
      ['added', 'via', 9],
      ['moved', 'via', 7],
    ],
  )
})

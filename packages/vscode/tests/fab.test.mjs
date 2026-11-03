// The Fabrication dialog against a real session: the cards of a clean board and of one with an unconnected net and no rev, the
// Build button through the real CLI, then an unsaved buffer, an uncommitted file and the missing rev, each blocker's action run.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { commands, docs, openDoc, panels } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { PcbjsServer } = require('../dist/server.cjs')
const { FabPanel, fabHtml } = require('../dist/fab-panel.cjs')
const { card, cards, dateSource, revInsert, readRepo } = require('../dist/fab.cjs')

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const BIN = path.join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pcbjs-fab-')))
const pids = new Set()
after(() => {
  for (const pid of pids)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  rmSync(tmp, { recursive: true, force: true })
})
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })

const board = (name, net, attrs, routed) => `import PCB, { defineFootprint, nets, route, type FootprintProps } from '@pcbjs/core'

const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint value="V" id="pcbjs:TestPad-2mm" bom={false} {...props}><pad num={1} size={2} shape="circle" /></footprint>
}, { pins: ['1'], prefix: 'TP' })
const { ${net} } = nets()
const TP1 = TestPad().connect({ 1: ${net} })
const TP2 = TestPad().connect({ 1: ${net} })

export default (
  <PCB name="${name}"${attrs}>
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />
    <TP1 at="5mm 10mm" />
    <TP2 at="15mm 10mm" />
    ${routed ? `{route('5 10').net(${net}).width(0.5).H(15)}` : ''}
  </PCB>
)
`

/** A committed project of two boards: Clean with a rev and its net routed, Open with no rev and its net left open. */
function project() {
  const root = path.join(tmp, 'p')
  mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  symlinkSync(path.join(REPO, 'node_modules', '@pcbjs'), path.join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.pcbjs\n')
  writeFileSync(
    path.join(root, 'pcb.config.ts'),
    "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['clean.pcb.tsx', 'open.pcb.tsx'], vite: { logLevel: 'silent' } })\n",
  )
  writeFileSync(path.join(root, 'clean.pcb.tsx'), board('Clean', 'V', ' rev="1.0"', true))
  writeFileSync(path.join(root, 'open.pcb.tsx'), board('Open', 'W', '', false))
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'boards')
  return root
}

const byName = (panel, name) => panel.cards.find(c => c.name === name)
const icons = c => c.blockers.map(b => b.icon)

test(
  'the dialog: cards and blockers of a clean board and one with errors, Build, an unsaved buffer, an uncommitted file and a missing rev, each acted on',
  { timeout: 300000 },
  async () => {
    const root = project()
    const server = new PcbjsServer({ folders: () => [root], name: 'vscode-pcbjs', version: '0.3.0', nodePath: () => process.execPath, readyTimeoutMs: 120000 })
    const opened = []
    const builds = []
    try {
      await server.start()
      await server.whenReady()
      pids.add(server.pid)
      const fab = new FabPanel({
        projects: () => [root],
        check: async r => (await server.client.request('session/check', { project: r, report: true }, 180000)).value,
        openFinding: async a => void opened.push(a),
        build: (r, env) =>
          new Promise(ok => {
            builds.push(env)
            execFile(process.execPath, [BIN, 'build', '-q'], { cwd: r, env: { ...process.env, ...env, NO_COLOR: '1' } }, err => ok(!err))
          }),
      })
      await fab.open()
      const panel = panels.find(p => p.viewType === 'pcbjs.fab')
      assert.equal(panel.title, 'Fabrication')
      assert.match(panel.webview.html, /Content-Security-Policy/)

      // before any build: Clean only lacks its set, Open is blocked by its open net and its missing rev
      let clean = byName(fab, 'Clean')
      let open = byName(fab, 'Open')
      assert.equal(clean.pill, 'STALE')
      assert.deepEqual(icons(clean), ['package'])
      assert.equal(clean.blockers[0].text, 'No fab set is built yet.')
      assert.equal(clean.zipName, 'Clean-fab-1.0.zip')
      assert.equal(open.pill, 'BLOCKED')
      assert.deepEqual(icons(open), ['debug-disconnect', 'tag', 'package'])
      assert.match(open.blockers[0].text, /^DRC unconnected: /)
      assert.deepEqual(
        open.blockers.map(b => b.action.label),
        ['Open the finding', 'Add rev', 'Build'],
      )
      assert.match(panel.webview.html, /class="pill stale">STALE/)
      assert.match(panel.webview.html, /class="pill bad">BLOCKED/)

      // open the finding: the host gets its id and its range in the code
      await fab.receive({ type: 'blocker', key: open.key, index: 0 })
      assert.equal(opened[0].board, 'Open')
      assert.match(opened[0].id, /^drc:unconnected:/)
      assert.equal(opened[0].file, path.join(root, 'open.pcb.tsx'))

      // Build: pcbjs build dated by the last commit, then Clean is orderable with its zip, size, sha256 and date source
      await fab.receive({ type: 'button', key: clean.key, name: 'build' })
      const head = Number(git(root, 'log', '-1', '--format=%ct').trim())
      assert.deepEqual(builds, [{ SOURCE_DATE_EPOCH: String(head) }])
      clean = byName(fab, 'Clean')
      assert.equal(clean.pill, 'ORDERABLE', clean.blockers.map(b => b.text).join('; '))
      assert.deepEqual(clean.blockers, [])
      const zip = path.join(root, '.pcbjs', 'fab', 'Clean', 'Clean-fab-1.0.zip')
      assert.equal(clean.zip, zip)
      assert.equal(clean.sha256, createHash('sha256').update(readFileSync(zip)).digest('hex'))
      assert.equal(clean.size, readFileSync(zip).length)
      assert.equal(clean.date, new Date(head * 1000).toISOString())
      assert.equal(clean.dateSource, 'the last commit, through SOURCE_DATE_EPOCH')
      assert.deepEqual(icons(byName(fab, 'Open')), ['debug-disconnect', 'tag'], 'its set is built, so only the errors and the rev block it')
      await fab.receive({ type: 'button', key: clean.key, name: 'sha' })
      await fab.receive({ type: 'button', key: clean.key, name: 'reveal' })
      await fab.receive({ type: 'button', key: clean.key, name: 'folder' })
      assert.deepEqual(
        commands.filter(c => c[0] === 'revealFileInOS' || c[0] === 'revealInExplorer').map(c => [c[0], c[1].fsPath]),
        [
          ['revealFileInOS', zip],
          ['revealInExplorer', path.dirname(zip)],
        ],
      )

      // an unsaved buffer of the board blocks it; Save writes it, and the set built before the write is stale
      const cleanFile = path.join(root, 'clean.pcb.tsx')
      openDoc(cleanFile, readFileSync(cleanFile, 'utf8'), { dirty: true })
      await fab.refresh()
      clean = byName(fab, 'Clean')
      assert.equal(clean.pill, 'BLOCKED')
      assert.deepEqual(icons(clean), ['circle-filled'])
      assert.equal(clean.blockers[0].text, 'clean.pcb.tsx has unsaved changes the set would not include.')
      await new Promise(r => setTimeout(r, 20))
      await fab.receive({ type: 'blocker', key: clean.key, index: 0 })
      clean = byName(fab, 'Clean')
      assert.equal(docs.find(d => d.uri.fsPath === cleanFile).isDirty, false)
      assert.equal(clean.pill, 'STALE')
      assert.deepEqual(
        clean.blockers.map(b => [b.icon, b.text, b.action.label]),
        [['history', 'clean.pcb.tsx changed after the set was built.', 'Build']],
      )

      // a change not committed blocks it; the action opens the source control view
      writeFileSync(cleanFile, readFileSync(cleanFile, 'utf8') + '// moved TP2\n')
      docs.find(d => d.uri.fsPath === cleanFile).text = readFileSync(cleanFile, 'utf8')
      await fab.refresh()
      clean = byName(fab, 'Clean')
      const commit = clean.blockers.find(b => b.icon === 'git-commit')
      assert.equal(commit.text, '1 file of the board is not committed: clean.pcb.tsx.')
      await fab.receive({ type: 'blocker', key: clean.key, index: clean.blockers.indexOf(commit) })
      assert.ok(commands.some(c => c[0] === 'workbench.view.scm'))

      // Add rev puts rev="0.1.0" on Open's <PCB> and saves; the next check has it
      open = byName(fab, 'Open')
      await fab.receive({ type: 'blocker', key: open.key, index: open.blockers.findIndex(b => b.icon === 'tag') })
      const text = readFileSync(path.join(root, 'open.pcb.tsx'), 'utf8')
      assert.match(text, /<PCB rev="0\.1\.0" name="Open">/)
      open = byName(fab, 'Open')
      assert.ok(!open.blockers.some(b => b.icon === 'tag'), open.blockers.map(b => b.text).join('; '))
      assert.ok(
        open.blockers.some(b => b.text === 'The set was built without a rev, the board is 0.1.0.'),
        'the set on disk is of no rev',
      )
      fab.dispose()
    } finally {
      await server.stop()
      try {
        execFileSync(process.execPath, [BIN, 'session', 'stop'], { cwd: root })
      } catch {}
    }
  },
)

test('the dialog model alone: a project outside git has no repository blocker, a failed self check and more findings than shown', async () => {
  const root = path.join(tmp, 'nogit')
  mkdirSync(root, { recursive: true })
  assert.equal(await readRepo(root), null)
  const findings = Array.from({ length: 8 }, (_, i) => ({ id: `drc:clearance:${i}`, kind: 'drc', severity: 'error', rule: 'clearance', message: `gap ${i}`, src: [] }))
  const v = {
    exitCode: 1,
    report: { boards: [{ name: 'B', target: null, entry: 'pcb.tsx', status: 'fail', findings, counts: null }], diagnostics: [] },
    sets: [
      {
        name: 'B',
        target: null,
        rev: '2',
        entry: path.join(root, 'pcb.tsx'),
        dir: path.join(root, 'set'),
        zip: path.join(root, 'set', 'B-fab-2.zip'),
        files: [path.join(root, 'pcb.tsx')],
      },
    ],
  }
  const disk = {
    zip: path.join(root, 'set', 'B-fab-2.zip'),
    size: 10,
    sha256: 'ab',
    mtime: Date.now() + 1e6,
    date: '2026-01-01T00:00:00.000Z',
    rev: '2',
    stale: null,
    selfCheck: 'failed',
  }
  const [c] = cards(root, v, [], null, () => disk)
  assert.equal(c.pill, 'BLOCKED')
  assert.deepEqual(icons(c), ['error', 'error', 'error', 'error', 'error', 'error', 'list-unordered', 'beaker'])
  assert.equal(c.blockers[6].text, '2 more errors block the set.')
  assert.equal(c.blockers[7].action.kind, 'open')
  assert.equal(c.dateSource, 'not the last commit: the build time or --date')
  assert.equal(dateSource('2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:00:00.000Z') / 1000), 'the last commit, through SOURCE_DATE_EPOCH')
  const stale = card({
    root,
    set: v.sets[0],
    board: { ...v.report.boards[0], findings: [] },
    disk: { ...disk, selfCheck: 'passed', stale: 'STALE: failed' },
    dirty: [],
    repo: null,
  })
  assert.equal(stale.pill, 'STALE')
  assert.equal(stale.blockers[0].text, 'The last build of this board failed, so the set is from an earlier one.')
  assert.deepEqual(revInsert('<PCB name="X">'), { offset: 4, text: ' rev="0.1.0"' })
  assert.equal(revInsert('export const x = 1'), null)
  assert.match(fabHtml([c], [], 'n'), /2 more errors block the set\./)
})

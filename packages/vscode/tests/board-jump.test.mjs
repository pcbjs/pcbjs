// A click on a board row of the Boards view asks the session to open the board's entry with focus; the session's answer, the
// `pcbjs/select` of the board's `<PCB`, opens the entry beside the preview with the cursor there and the editor focused. A folder
// row's click only expands it, unless the folder declares one board, which it then shows and opens as a board row does.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { vscode, layout, group, setGroups } from './vscode.mjs'
import { pcbRange } from '@pcbjs/cli/internal/selection'
import { selectParams } from '@pcbjs/lsp'

const require = createRequire(import.meta.url)
const { boardNodes, entryJump, entryJumper, openFolder } = require('../dist/tree-data.cjs')
const { showSelect } = require('../dist/reveal.cjs')

const root = mkdtempSync(join(tmpdir(), 'pcbjs-jump-'))
after(() => rmSync(root, { recursive: true, force: true }))
const ENTRY = `import PCB from '@pcbjs/core'

export default (
  <PCB name="Blinky">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={10} />
  </PCB>
)
`
writeFileSync(join(root, 'blinky.pcb.tsx'), ENTRY)
const info = { boards: [{ name: 'Blinky', title: 'Blinky', entry: 'blinky.pcb.tsx', targets: ['house', 'fab'], status: 'ok' }], single: true, errors: {}, root }

/** The session's answer to a board reference alone, as it sends it to an editor. */
function session(method, p) {
  assert.equal(method, 'session/select')
  assert.deepEqual(p.refs, [`board:${p.board}`])
  const file = join(root, info.boards.find(b => b.name === p.board).entry)
  return selectParams([pcbRange(file, ENTRY)], true, p.focus)
}

test('a board row opens its entry with the cursor on <PCB and the editor focused, once for a board of several targets', async () => {
  const row = boardNodes(info, undefined, undefined)[0].children[0]
  assert.deepEqual(row.action, { kind: 'board', name: 'Blinky', project: root, entry: join(root, 'blinky.pcb.tsx'), route: '/' })
  const pane = group('pane')
  setGroups([group('/work/other.ts'), pane], 1)
  layout.calls = []
  let kept = 0
  const editor = await showSelect(session('session/select', entryJump(row.action.name)), { last: () => 1, size: () => undefined }, show => (kept++, show()))
  assert.equal(editor.document.uri.fsPath, join(root, 'blinky.pcb.tsx'))
  assert.equal(editor.selections.length, 1)
  assert.equal(ENTRY.split('\n')[editor.selections[0].active.line].trim().slice(0, 4), '<PCB')
  assert.deepEqual([editor.selections[0].start.character, editor.selections[0].end.character], [2, 6])
  assert.equal(editor.viewColumn, 1, 'beside the preview')
  assert.equal(layout.shows.at(-1).preview, true, 'sidebar navigation requests a temporary source editor')
  assert.deepEqual(
    layout.calls.filter(c => c[0] === 'show').map(c => c[2]),
    [false],
    'the editor takes focus',
  )
  assert.equal(kept, 0, 'the tree click does not keep focus in the pane')
})

test('the same answer without focus keeps the preview focused, as the viewer selector asks', async () => {
  setGroups([group('/work/other.ts'), group('pane')], 1)
  layout.calls = []
  let kept = 0
  const p = session('session/select', { board: 'Blinky', refs: ['board:Blinky'] })
  const editor = await showSelect(p, { last: () => 1, size: () => undefined }, show => (kept++, show()))
  assert.equal(editor.document.uri.fsPath, join(root, 'blinky.pcb.tsx'))
  assert.equal(kept, 1)
  assert.deepEqual(
    layout.calls.filter(c => c[0] === 'show').map(c => c[2]),
    [true],
  )
  assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, 2, 'the pane group stays active')
})

test('config rows expand directly to boards from every entry', async () => {
  const demo = { root: '/work/demo', route: '/demo/', displayed: true }
  const solo = { root, route: '/solo/', displayed: false, boards: [] }
  const declared = { '/work/demo': ['/work/demo/a.tsx', '/work/demo/b.tsx'], [root]: [join(root, 'blinky.pcb.tsx')] }
  const rows = boardNodes(
    {
      ...info,
      root: '/work/demo',
      boards: [
        { name: 'A', entry: 'a.tsx' },
        { name: 'B', entry: 'b.tsx' },
      ],
    },
    { scopes: [demo, solo], single: false },
    'A',
    [],
    declared,
  )
  assert.deepEqual(
    rows.map(r => r.label),
    ['demo', basename(root)],
  )
  assert.equal(rows[0].action, undefined)
  assert.equal(rows[0].children[0].action.kind, 'board')
  assert.deepEqual(
    rows[0].children.map(r => r.label),
    ['A', 'B'],
  )
  assert.deepEqual(rows[0].load.entries, ['/work/demo/a.tsx', '/work/demo/b.tsx'])
  assert.deepEqual(rows[1].load, { root, entries: [join(root, 'blinky.pcb.tsx')], route: '/solo/' })
  const calls = []
  await openFolder({ kind: 'scope', id: 'config:solo', root, route: '/solo/' }, { expand: async id => calls.push(id), show: () => assert.fail('expansion must not navigate') })
  assert.deepEqual(calls, ['config:solo'])
})

for (const close of [false, true])
  test(`board jump retains exact project while compile waits, closed=${close}`, async () => {
    const sent = []
    const a = { open: true, request: async (method, params) => sent.push({ method, params }) }
    const jump = entryJumper(a, '/project/A')
    if (close) a.open = false
    await jump('Board')
    assert.deepEqual(sent, close ? [] : [{ method: 'session/select', params: entryJump('Board', '/project/A') }])
  })

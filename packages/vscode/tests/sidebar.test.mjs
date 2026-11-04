import { resolve as fixturePath } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import './vscode.mjs'

const require = createRequire(import.meta.url)
const { Sidebar } = require('../dist/sidebar.cjs')
const { vscode } = await import('./vscode.mjs')

const boardsMessage = {
  boards: [
    { name: 'Blinky', title: 'Blinky', entry: 'blinky.pcb.tsx', targets: [], status: 'ok' },
    { name: 'Coin', title: 'Coin cell', entry: 'coin.tsx', targets: [], status: 'error' },
  ],
  single: false,
  errors: {},
  root: fixturePath('/work/demo'),
}

const site = (name, over = {}) => ({
  name,
  title: name,
  drc: [],
  erc: [],
  nets: ['GND', 'VCC'],
  bom: [{ refs: ['R1', 'R2'], value: '10k', footprint: 'R_0603', qty: 2, fields: { MPN: 'RC0603' } }],
  footprints: [
    { ref: 'R1', src: { file: 'blinky.pcb.tsx', line: 30, col: 5, endLine: 30, endCol: 20 }, pads: [{ net: 'GND' }, { net: 'VCC' }] },
    { ref: 'R2', pads: [{ net: 'GND' }, { net: null }] },
  ],
  sources: {
    'lib/part.tsx': [
      { start: [4, 3], end: [9, 4], ids: [7, 8, 9] },
      { start: [5, 5], end: [5, 30], ids: [8] },
    ],
  },
  ...over,
})

const sites = {
  Blinky: site('Blinky', {
    drc: [
      {
        id: 'drc:silk-over-edge:000000000001',
        fingerprint: 'e1',
        severity: 'warning',
        rule: 'silk-over-edge',
        message: 'J1 silk crosses the edge',
        at: [1.234, 5],
        layer: 'F.SilkS',
        items: [8],
        refs: ['J1'],
      },
      {
        id: 'drc:clearance:000000000002',
        fingerprint: 'c1',
        severity: 'error',
        rule: 'clearance',
        message: '0.1 mm < 0.2 mm',
        at: [3, 4],
        refs: ['R1/1', 'net:GND'],
        src: [{ file: 'blinky.pcb.tsx', start: [12, 3], end: [12, 40], role: 'item' }],
      },
    ],
  }),
  Coin: site('Coin', {
    erc: [{ id: 'erc:unconnected-pin:000000000003', fingerprint: 'u1', severity: 'error', rule: 'unconnected-pin', message: 'U1/3 is not connected', at: [10, 20], layer: 'sch' }],
  }),
}

const server = {
  root: fixturePath('/work/demo'),
  url: 'http://127.0.0.1:5301/',
  boards: boardsMessage,
  scopes: undefined,
  scope: undefined,
}

/** A site as `session/facets` answers it: its keys split over facets, each with a hash. */
const facetsOf = (s, hash = 'h') => [
  { board: s.name, facet: 'meta', hash, data: { name: s.name, title: s.title, nets: s.nets, footprints: s.footprints } },
  { board: s.name, facet: 'layers', hash, data: { sources: s.sources } },
  { board: s.name, facet: 'findings', hash, data: { drc: s.drc, erc: s.erc } },
  { board: s.name, facet: 'fab', hash, data: { bom: s.bom } },
]

const boardRows = nodes => nodes.flatMap(n => (n.action?.kind === 'board' ? [n] : boardRows(n.children ?? [])))
const plain = nodes => nodes.map(n => [n.label, n.description, ...(n.children ? [plain(n.children)] : [])])

test('the trees from a boards message and the site data of each board', async () => {
  const fetched = []
  const bar = new Sidebar(async (_server, entry) => {
    fetched.push(entry)
    return facetsOf(sites[entry.endsWith('coin.tsx') ? 'Coin' : 'Blinky'])
  }, false)
  await bar.update(server, boardsMessage.boards[0])
  assert.deepEqual(fetched, [fixturePath('/work/demo/blinky.pcb.tsx'), fixturePath('/work/demo/coin.tsx')])
  const p = bar.providers
  assert.deepEqual(plain(boardRows(p.boards.nodes)), [
    [
      'Blinky',
      'shown',
      [
        ['R1', undefined],
        ['R2', undefined],
      ],
    ],
    ['Coin cell', 'error'],
  ])
  assert.deepEqual(boardRows(p.boards.nodes)[0].children[0].action, {
    kind: 'ref',
    project: fixturePath('/work/demo'),
    target: null,
    board: 'Blinky',
    ref: 'R1',
    source: { file: fixturePath('/work/demo/blinky.pcb.tsx'), line: 30, col: 5, endLine: 30, endCol: 20 },
  })
  assert.deepEqual(plain(p.findings.nodes), [
    [
      'Errors',
      '2',
      [
        [
          'clearance',
          'Blinky · 0.1 mm < 0.2 mm',
          [
            ['R1/1', undefined],
            ['net:GND', undefined],
          ],
        ],
        ['unconnected-pin', 'Coin · U1/3 is not connected'],
      ],
    ],
    ['Warnings', '1', [['silk-over-edge', 'Blinky · J1 silk crosses the edge', [['J1', undefined]]]]],
  ])
  const [clearance, erc] = p.findings.nodes[0].children
  assert.equal(clearance.id, 'finding:Blinky:drc:clearance:000000000002')
  assert.deepEqual(clearance.action, {
    kind: 'finding',
    project: fixturePath('/work/demo'),
    target: null,
    board: 'Blinky',
    id: 'drc:clearance:000000000002',
    source: { file: fixturePath('/work/demo/blinky.pcb.tsx'), line: 12, col: 3, endLine: 12, endCol: 40 },
  })
  assert.equal(erc.action.id, 'erc:unconnected-pin:000000000003')
  assert.deepEqual(clearance.children[1].action, { kind: 'ref', board: 'Blinky', ref: 'net:GND', project: fixturePath('/work/demo'), target: null })
  // no range of its own: the narrowest range that drew one of its items
  assert.deepEqual(p.findings.nodes[1].children[0].action.source, { file: fixturePath('/work/demo/lib/part.tsx'), line: 5, col: 5, endLine: 5, endCol: 30 })
  assert.deepEqual(plain(p.nets.nodes), [
    ['GND', '2 pads'],
    ['VCC', '1 pad'],
  ])
  assert.deepEqual(p.nets.nodes[0].action, { kind: 'net', board: 'Blinky', net: 'GND', project: fixturePath('/work/demo'), target: null })
  assert.deepEqual(plain(p.bom.nodes), [['R1, R2', '10k · 2x']])
  assert.equal(p.bom.nodes[0].action.source.file, fixturePath('/work/demo/blinky.pcb.tsx'))
  const item = p.findings.getTreeItem(clearance)
  assert.equal(item.command.command, 'pcbjs.sidebar.open')
  assert.equal(item.iconPath.id, 'error')
  assert.equal(p.findings.getTreeItem(p.findings.nodes[0]).collapsibleState, vscode.TreeItemCollapsibleState.Expanded)
  // a board row carries the inline 2D, 3D and schematic actions; a finding only Send to agent
  assert.equal(p.boards.getTreeItem(boardRows(p.boards.nodes)[0]).contextValue, 'board')
  assert.equal(item.contextValue, 'finding')

  // the same message again fetches nothing; Nets and BOM follow the board shown
  await bar.update(server, boardsMessage.boards[1])
  assert.equal(fetched.length, 2)
  assert.deepEqual(p.nets.nodes[0].action.board, 'Coin')
  assert.deepEqual(plain(boardRows(p.boards.nodes)), [
    ['Blinky', undefined],
    [
      'Coin cell',
      'shown, error',
      [
        ['R1', undefined],
        ['R2', undefined],
      ],
    ],
  ])
})

test('a recompile that renumbers keeps the selected finding and its open refs by fingerprint, nearest its old place', async () => {
  const at = (id, x) => ({ id, fingerprint: 'same', severity: 'error', rule: 'clearance', message: 'm', at: [x, 0], refs: ['R1/1'] })
  let drc = [at('drc:clearance:00000000000a', 1), at('drc:clearance:00000000000b', 9)]
  const bar = new Sidebar(async () => facetsOf(site('Blinky', { drc })), false)
  const msg = { ...boardsMessage, boards: [boardsMessage.boards[0]] }
  await bar.update({ ...server, boards: msg }, msg.boards[0])
  const old = bar.providers.findings.nodes[0].children[1]
  bar.state.findings = { selected: old.id, expanded: [old.id] }
  // the part moved: both ids change, the second one now sits at 9.5
  drc = [at('drc:clearance:00000000000c', 1.2), at('drc:clearance:00000000000d', 9.5)]
  const next = { ...msg }
  await bar.update({ ...server, boards: next }, next.boards[0])
  const now = bar.providers.findings.nodes[0].children
  assert.deepEqual(bar.state.findings, { selected: 'finding:Blinky:drc:clearance:00000000000d', expanded: ['finding:Blinky:drc:clearance:00000000000d'] })
  assert.equal(now[1].expanded, true)
  assert.equal(now[0].expanded, false)
  assert.equal(bar.providers.findings.getTreeItem(now[1]).collapsibleState, vscode.TreeItemCollapsibleState.Expanded)
  // a selected ref row of a renumbered finding follows it too
  bar.state.findings = { selected: `${now[0].id}/R1/1`, expanded: [] }
  drc = [at('drc:clearance:00000000000e', 1.1), at('drc:clearance:00000000000f', 9.5)]
  await bar.update({ ...server, boards: { ...msg } }, msg.boards[0])
  assert.equal(bar.state.findings.selected, 'finding:Blinky:drc:clearance:00000000000e/R1/1')
})

test('a workspace server lists its projects, the shown one open with its boards', async () => {
  const bar = new Sidebar(async () => undefined, false)
  const scopes = {
    scopes: [
      { slug: 'demo', name: 'demo', root: fixturePath('/work/demo'), route: '/demo/', status: 'ready', displayed: true },
      { slug: 'usb-hub', name: 'usb-hub', root: fixturePath('/work/usb-hub'), route: '/usb-hub/', status: 'idle', displayed: false },
    ],
    displayed: 'demo',
    single: false,
  }
  await bar.update({ ...server, scopes }, boardsMessage.boards[0])
  const configs = bar.providers.boards.nodes
  assert.deepEqual(
    configs.map(n => n.label),
    ['demo', 'usb-hub'],
  )
  const relativePath = vscode.workspace.asRelativePath
  try {
    vscode.workspace.asRelativePath = file => `examples/${file.slice(fixturePath('/work').length + 1).replaceAll('\\', '/')}`
    await bar.update({ ...server, scopes }, boardsMessage.boards[0])
    assert.deepEqual(
      bar.providers.boards.nodes.map(n => n.label),
      ['examples/demo', 'examples/usb-hub'],
    )
    vscode.workspace.asRelativePath = () => 'pcb.config.ts'
    await bar.update(server, boardsMessage.boards[0])
    assert.equal(bar.providers.boards.nodes[0].label, 'demo')
  } finally {
    vscode.workspace.asRelativePath = relativePath
  }
  assert.ok(configs.every(n => n.action === undefined))
  assert.deepEqual(
    configs[0].children.map(n => n.label),
    ['Blinky', 'Coin cell'],
  )
  assert.deepEqual(
    boardRows(configs).map(n => n.action.name),
    ['Blinky', 'Coin'],
  )
  assert.deepEqual(bar.providers.findings.nodes, [])
})

test('session/state: a held facet whose hash moved reloads the facets; the same hashes or another project load nothing', async () => {
  let hash = 'a',
    loads = 0
  const bar = new Sidebar(async () => (loads++, facetsOf(site('Blinky'), hash)), false)
  const msg = { ...boardsMessage, boards: [boardsMessage.boards[0]] }
  await bar.update({ ...server, boards: msg }, msg.boards[0])
  assert.equal(loads, 1)
  const settle = () => new Promise(r => setTimeout(r, 10))
  bar.synced(fixturePath('/work/demo'), { 'meta:Blinky': 'a', 'findings:Blinky': 'a' })
  bar.synced(fixturePath('/work/other'), { 'meta:Blinky': 'b' })
  await settle()
  assert.equal(loads, 1)
  hash = 'b'
  bar.synced(fixturePath('/work/demo'), { 'meta:Blinky': 'a', 'findings:Blinky': 'b' })
  await settle()
  assert.equal(loads, 2)
  bar.synced(fixturePath('/work/demo'), { 'meta:Blinky': 'b', 'findings:Blinky': 'b' })
  await settle()
  assert.equal(loads, 2, 'in sync again')
})

test('sidebar actions explicitly select the first target instead of preserving divergent viewer target', async () => {
  const first = site('Blinky')
  const bar = new Sidebar(async () => [{ board: 'Blinky', target: 'first', facet: 'meta', hash: 'first', data: first }], false)
  await bar.update({ session: 'A', root: fixturePath('/work/demo'), boards: boardsMessage }, boardsMessage.boards[0])
  for (const tree of ['findings', 'nets', 'bom', 'boards']) {
    const visit = nodes => nodes.flatMap(n => [n, ...visit(n.children ?? [])])
    for (const n of visit(bar.providers[tree].nodes)) {
      if (!n.action || !['finding', 'ref', 'net', 'source'].includes(n.action.kind)) continue
      assert.equal(n.action.target, null, `${tree} resets a displayed second target`)
      assert.equal(n.action.session, 'A')
      assert.equal(n.action.project, fixturePath('/work/demo'))
    }
  }
  bar.dispose()
})

test('expanding a config resolves all entries directly to boards without selection or navigation', async () => {
  const calls = []
  const source = {
    ...server,
    session: 'A',
    request: async (method, params) => {
      calls.push([method, params])
      return {
        value: {
          boards: [
            { entry: 'pcb.tsx', name: 'Remote', current: true, targets: [null] },
            { entry: 'second.tsx', name: 'Second', current: true, targets: [null] },
          ],
        },
      }
    },
    scopes: {
      single: false,
      scopes: [
        { root: fixturePath('/work/demo'), route: '/demo/', displayed: true },
        { root: fixturePath('/work/other'), route: '/other/', displayed: false },
      ],
    },
  }
  const bar = new Sidebar(
    async () => [],
    false,
    async () => ({
      [fixturePath('/work/demo')]: [fixturePath('/work/demo/blinky.pcb.tsx'), fixturePath('/work/demo/coin.tsx')],
      [fixturePath('/work/other')]: [fixturePath('/work/other/pcb.tsx'), fixturePath('/work/other/second.tsx')],
    }),
  )
  await bar.update(source, boardsMessage.boards[0])
  const config = bar.providers.boards.nodes[1]
  assert.equal(bar.providers.boards.getTreeItem(config).command, undefined)
  const [board, second] = await bar.providers.boards.getChildren(config)
  assert.deepEqual(calls, [['session/boards', { project: fixturePath('/work/other'), entries: [fixturePath('/work/other/pcb.tsx'), fixturePath('/work/other/second.tsx')] }]])
  assert.deepEqual(
    config.children.map(n => n.label),
    ['Remote', 'Second'],
  )
  assert.equal(second.action.entry, fixturePath('/work/other/second.tsx'))
  assert.equal(bar.providers.boards.getParent(second), config)
  assert.equal(board.action.project, fixturePath('/work/other'))
  assert.equal(board.action.session, 'A')
  assert.equal(board.action.entry, fixturePath('/work/other/pcb.tsx'))
  assert.equal(bar.providers.boards.getParent(board), config)
  bar.dispose()
})

test('an explicitly collapsed config stays collapsed across sidebar refresh', async () => {
  const bar = new Sidebar(async () => [], false)
  await bar.update(server, boardsMessage.boards[0])
  const id = bar.providers.boards.nodes[0].id
  bar.state.boards = { expanded: [], collapsed: [id] }
  await bar.update(server, boardsMessage.boards[1])
  assert.equal(bar.providers.boards.nodes[0].expanded, false)
  assert.deepEqual(bar.state.boards.collapsed, [id])
  bar.dispose()
})

test('slower config discovery cannot replace a newer same-link same-board tree', async () => {
  let release, entered
  const started = new Promise(resolve => {
    entered = resolve
  })
  let count = 0
  const bar = new Sidebar(
    async () => [],
    false,
    async () => {
      if (++count === 1) {
        entered()
        await new Promise(resolve => {
          release = resolve
        })
        return { [fixturePath('/work/demo')]: [fixturePath('/work/demo/old.tsx')] }
      }
      return { [fixturePath('/work/demo')]: [fixturePath('/work/demo/new.tsx'), fixturePath('/work/demo/second.tsx')] }
    },
  )
  const first = bar.update(server, boardsMessage.boards[0])
  await started
  const second = bar.update(server, boardsMessage.boards[0])
  await second
  release()
  await first
  assert.deepEqual(bar.providers.boards.nodes[0].load.entries, [fixturePath('/work/demo/new.tsx'), fixturePath('/work/demo/second.tsx')])
  assert.deepEqual(bar.providers.boards.nodes[0].children, [])
  bar.dispose()
})

test('facets from a shared entry keep board identity and first-target data separate', async () => {
  const a = site('A', { nets: ['A_NET'] }),
    b = site('B', { nets: ['B_NET'] })
  const bar = new Sidebar(
    async () => [
      ...facetsOf(a).map(f => ({ ...f, target: 'first' })),
      ...facetsOf(b).map(f => ({ ...f, target: 'first' })),
      ...facetsOf(site('A', { nets: ['WRONG_TARGET'] })).map(f => ({ ...f, target: 'second' })),
    ],
    false,
  )
  const info = {
    ...boardsMessage,
    boards: [
      { name: 'A', entry: 'shared.tsx' },
      { name: 'B', entry: 'shared.tsx' },
    ],
  }
  await bar.update({ ...server, boards: info }, info.boards[0])
  assert.equal(bar.providers.nets.nodes[0].label, 'A_NET')
  await bar.update({ ...server, boards: info }, info.boards[1])
  assert.equal(bar.providers.nets.nodes[0].label, 'B_NET')
  bar.dispose()
})

test('workspace-root configs resolve automatically to top-level boards while nested configs stay lazy', async () => {
  const { ui } = await import('./vscode.mjs')
  const previous = ui.folders
  ui.folders = [fixturePath('/work/demo'), fixturePath('/work/other')]
  const calls = []
  const source = {
    ...server,
    session: 'A',
    scopes: {
      single: false,
      scopes: [
        { root: fixturePath('/work/demo'), route: '/demo/', displayed: true },
        { root: fixturePath('/work/demo/nested'), route: '/nested/', displayed: false },
        { root: fixturePath('/work/other'), route: '/other/', displayed: false },
      ],
    },
    request: async (method, params) => {
      calls.push([method, params])
      return {
        value: {
          boards:
            params.project === fixturePath('/work/demo')
              ? [
                  { name: 'Blinky', entry: 'blinky.pcb.tsx', current: true, targets: [null] },
                  { name: 'Extra', entry: 'second.tsx', current: true, targets: [null] },
                ]
              : [{ name: 'Blinky', entry: 'pcb.tsx', current: true, targets: [null] }],
        },
      }
    },
  }
  const bar = new Sidebar(
    async () => facetsOf(sites.Blinky),
    false,
    async () => ({
      [fixturePath('/work/demo')]: [fixturePath('/work/demo/blinky.pcb.tsx'), fixturePath('/work/demo/second.tsx')],
      [fixturePath('/work/demo/nested')]: [fixturePath('/work/demo/nested/pcb.tsx')],
      [fixturePath('/work/other')]: [fixturePath('/work/other/pcb.tsx')],
    }),
  )
  try {
    await bar.update(source, boardsMessage.boards[0])
    const nodes = bar.providers.boards.nodes
    assert.deepEqual(
      nodes.map(n => n.label),
      ['Blinky', 'Extra', 'nested', 'Blinky'],
    )
    assert.deepEqual(calls, [
      ['session/boards', { project: fixturePath('/work/demo'), entries: [fixturePath('/work/demo/blinky.pcb.tsx'), fixturePath('/work/demo/second.tsx')] }],
      ['session/boards', { project: fixturePath('/work/other'), entries: [fixturePath('/work/other/pcb.tsx')] }],
    ])
    assert.equal(bar.providers.boards.getParent(nodes[0]), undefined)
    assert.equal(nodes[0].action.entry, fixturePath('/work/demo/blinky.pcb.tsx'))
    assert.equal(nodes[3].action.entry, fixturePath('/work/other/pcb.tsx'))
    assert.equal(nodes[3].action.project, fixturePath('/work/other'))
    assert.equal(nodes[3].action.session, 'A')
    assert.notEqual(nodes[0].id, nodes[3].id)
    assert.equal(nodes[3].description, undefined, 'the same-named board in another project is not shown')
    assert.equal(nodes[0].children[0].action.project, fixturePath('/work/demo'))
    assert.equal(bar.providers.boards.getParent(nodes[0].children[0]), nodes[0])
    assert.equal(bar.providers.boards.getTreeItem(nodes[2]).command, undefined)
  } finally {
    bar.dispose()
    ui.folders = previous
  }
})

test('a failed root config remains visible with its resolution error', async () => {
  const { ui } = await import('./vscode.mjs')
  const previous = ui.folders
  ui.folders = [fixturePath('/work/demo')]
  const bar = new Sidebar(
    async () => [],
    false,
    async () => ({ [fixturePath('/work/demo')]: [fixturePath('/work/demo/blinky.pcb.tsx')] }),
  )
  try {
    await bar.update(
      {
        ...server,
        request: async () => {
          throw new Error('Invalid config')
        },
      },
      undefined,
    )
    const [node] = bar.providers.boards.nodes
    assert.equal(node.id, `config:${fixturePath('/work/demo/pcb.config.ts')}`)
    assert.equal(node.description, 'Unable to resolve: Invalid config')
    assert.equal(node.load.root, fixturePath('/work/demo'), 'expansion can retry')
  } finally {
    bar.dispose()
    ui.folders = previous
  }
})

test('a stale root resolution cannot replace the latest board tree', async () => {
  const { ui } = await import('./vscode.mjs')
  const previous = ui.folders
  ui.folders = [fixturePath('/work/demo')]
  let release,
    entered,
    count = 0
  const started = new Promise(resolve => {
    entered = resolve
  })
  const source = {
    ...server,
    request: async () => {
      const first = ++count === 1
      if (first) {
        entered()
        await new Promise(resolve => {
          release = resolve
        })
      }
      return { value: { boards: [{ name: first ? 'Old' : 'New', entry: 'blinky.pcb.tsx', current: true }] } }
    },
  }
  const bar = new Sidebar(
    async () => [],
    false,
    async () => ({ [fixturePath('/work/demo')]: [fixturePath('/work/demo/blinky.pcb.tsx')] }),
  )
  try {
    const first = bar.update(source, undefined)
    await started
    await bar.update(source, undefined)
    release()
    await first
    assert.deepEqual(
      bar.providers.boards.nodes.map(n => n.label),
      ['New'],
    )
  } finally {
    release?.()
    bar.dispose()
    ui.folders = previous
  }
})

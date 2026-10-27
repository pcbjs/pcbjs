import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './vscode.mjs';

const require = createRequire(import.meta.url);
const { Sidebar } = require('../dist/sidebar.cjs');
const { vscode } = await import('./vscode.mjs');

const boardsMessage = {
  boards: [
    { name: 'Blinky', title: 'Blinky', entry: 'blinky.pcb.tsx', targets: [], status: 'ok' },
    { name: 'Coin', title: 'Coin cell', entry: 'coin.tsx', targets: [], status: 'error' },
  ],
  single: false,
  errors: {},
  root: '/work/demo',
};

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
});

const sites = {
  Blinky: site('Blinky', {
    drc: [
      { severity: 'warning', rule: 'silk-over-edge', message: 'J1 silk crosses the edge', at: [1.234, 5], layer: 'F.SilkS', items: [8] },
      { severity: 'error', rule: 'clearance', message: '0.1 mm < 0.2 mm', at: [3, 4], src: { file: 'blinky.pcb.tsx', line: 12, col: 3, endLine: 12, endCol: 40 } },
    ],
  }),
  Coin: site('Coin', { erc: [{ severity: 'error', rule: 'pin-unconnected', message: 'U1.3 is not connected', at: [10, 20], layer: 'sch' }] }),
};

const server = {
  root: '/work/demo',
  url: 'http://127.0.0.1:5301/',
  boards: boardsMessage,
  scopes: undefined,
  scope: undefined,
};

const plain = (nodes) => nodes.map((n) => [n.label, n.description, ...(n.children ? [plain(n.children)] : [])]);

test('the trees from a boards message and the site data of each board', async () => {
  const fetched = [];
  const bar = new Sidebar(async (url) => {
    fetched.push(url);
    return sites[decodeURIComponent(url.split('/')[4])];
  }, false);
  await bar.update(server, boardsMessage.boards[0]);
  assert.deepEqual(fetched, ['http://127.0.0.1:5301/__pcbjs/Blinky/board.json', 'http://127.0.0.1:5301/__pcbjs/Coin/board.json']);
  const p = bar.providers;
  assert.deepEqual(plain(p.boards.nodes), [
    ['Blinky', 'shown'],
    ['Coin cell', 'error'],
  ]);
  assert.deepEqual(plain(p.findings.nodes), [
    [
      'Errors',
      '2',
      [
        ['clearance', 'Blinky · 0.1 mm < 0.2 mm'],
        ['pin-unconnected', 'Coin · U1.3 is not connected'],
      ],
    ],
    ['Warnings', '1', [['silk-over-edge', 'Blinky · J1 silk crosses the edge']]],
  ]);
  const [clearance, erc] = p.findings.nodes[0].children;
  assert.deepEqual(clearance.action, { kind: 'finding', board: 'Blinky', at: [3, 4], layer: null, source: { file: '/work/demo/blinky.pcb.tsx', line: 12, col: 3, endLine: 12, endCol: 40 } });
  assert.equal(erc.action.layer, 'sch');
  // no range of its own: the narrowest range that drew one of its items
  assert.deepEqual(p.findings.nodes[1].children[0].action.source, { file: '/work/demo/lib/part.tsx', line: 5, col: 5, endLine: 5, endCol: 30 });
  assert.deepEqual(plain(p.nets.nodes), [
    ['GND', '2 pads'],
    ['VCC', '1 pad'],
  ]);
  assert.deepEqual(p.nets.nodes[0].action, { kind: 'net', board: 'Blinky', net: 'GND' });
  assert.deepEqual(plain(p.bom.nodes), [['R1, R2', '10k · 2x']]);
  assert.equal(p.bom.nodes[0].action.source.file, '/work/demo/blinky.pcb.tsx');
  const item = p.findings.getTreeItem(clearance);
  assert.equal(item.command.command, 'pcbjs.sidebar.open');
  assert.equal(item.iconPath.id, 'error');
  assert.equal(p.findings.getTreeItem(p.findings.nodes[0]).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  // a board row carries the inline 2D, 3D and schematic actions; a finding none
  assert.equal(p.boards.getTreeItem(p.boards.nodes[0]).contextValue, 'board');
  assert.equal(item.contextValue, undefined);

  // the same message again fetches nothing; Nets and BOM follow the board shown
  await bar.update(server, boardsMessage.boards[1]);
  assert.equal(fetched.length, 2);
  assert.deepEqual(p.nets.nodes[0].action.board, 'Coin');
  assert.deepEqual(plain(p.boards.nodes), [
    ['Blinky', undefined],
    ['Coin cell', 'shown, error'],
  ]);
});

test('a workspace server lists its projects, the shown one open with its boards', async () => {
  const bar = new Sidebar(async () => undefined, false);
  const scopes = {
    scopes: [
      { slug: 'demo', name: 'demo', root: '/work/demo', route: '/demo/', status: 'ready', displayed: true },
      { slug: 'usb-hub', name: 'usb-hub', root: '/work/usb-hub', route: '/usb-hub/', status: 'idle', displayed: false },
    ],
    displayed: 'demo',
    single: false,
  };
  await bar.update({ ...server, scopes }, boardsMessage.boards[0]);
  assert.deepEqual(plain(bar.providers.boards.nodes), [
    [
      'demo',
      'shown',
      [
        ['Blinky', 'shown'],
        ['Coin cell', 'error'],
      ],
    ],
    ['usb-hub', 'idle'],
  ]);
  assert.deepEqual(bar.providers.boards.nodes[1].action, { kind: 'scope', route: '/usb-hub/' });
  assert.deepEqual(bar.providers.findings.nodes, []);
});

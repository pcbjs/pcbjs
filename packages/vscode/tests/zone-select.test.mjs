// A click on a pour reaches the editor: a real dev server dials the extension's host, the viewer's open request for the
// zone goes out as pcbjs:ide:select, and the host hands the editor the whole pour() call and the stitch() call of a via.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dev } from '@pcbjs/cli/server';
import { until } from './fake.mjs';

const require = createRequire(import.meta.url);
const { IdeHost } = require('../dist/host.cjs');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PCB = `import PCB, { nets, pour, stitch } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'
const { GND, VCC } = nets()
const J1 = PinHeader(2).connect(GND, VCC)
export default (
  <PCB name="Z">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={20} />
    <J1 at="10 10" />
    {pour(GND, 'B.Cu', 'M 0 0 H 20 V 20 H 0 Z')}
    {pour(GND, 'F.Cu', 'M 0 0 H 20 V 20 H 0 Z')}
    {stitch(GND)}
  </PCB>
)
`;

test('a select of a zone and of a stitching via reaches the editor with the whole call', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-zone-')));
  mkdirSync(join(root, 'node_modules'));
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir');
  writeFileSync(join(root, 'pcb.config.ts'), `import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n`);
  writeFileSync(join(root, 'pcb.tsx'), PCB);
  const selects = [];
  const host = new IdeHost({ name: 'vscode-pcbjs', version: '9.9.9', editor: { select: (req) => selects.push(req), log: () => {} } });
  let server;
  try {
    server = await dev({ root, port: 0, host: '127.0.0.1', ide: await host.listen() });
    await until(() => host.clients.size === 1);
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const site = await (await fetch(`${base}/__pcbjs/Z/board.json`)).json();
    const lines = PCB.split('\n');
    const open = async (id) => {
      const r = site.sources['pcb.tsx'].find((r) => r.ids.includes(id));
      selects.length = 0;
      const res = await fetch(`${base}/__pcbjs/open?file=pcb.tsx&line=${r.start[0]}&col=${r.start[1]}&endLine=${r.end[0]}&endCol=${r.end[1]}`);
      assert.equal(res.headers.get('x-pcbjs-opened'), 'host');
      await until(() => selects.length === 1);
      const s = selects[0];
      assert.equal(s.file, join(root, 'pcb.tsx'));
      assert.equal(s.line, s.endLine);
      return lines[s.line - 1].slice(s.col - 1, s.endCol);
    };
    const zones = site.items.filter((i) => i.kind === 'zone');
    assert.equal(zones.length, 2);
    assert.equal(await open(zones.find((z) => z.layers.includes('B.Cu')).id), `pour(GND, 'B.Cu', 'M 0 0 H 20 V 20 H 0 Z')`);
    const via = site.items.find((i) => i.kind === 'via');
    assert.ok(via, 'no stitching via');
    assert.equal(await open(via.id), 'stitch(GND)');
  } finally {
    await server?.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

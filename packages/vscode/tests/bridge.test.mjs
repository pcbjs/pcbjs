import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { WebSocketServer, WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const { Bridge, socketUrl } = require('../dist/bridge.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A mock Vite HMR server: checks the subprotocol, greets with connected, records custom events. */
async function mockServer(port = 0) {
  const wss = new WebSocketServer({ port, handleProtocols: (p) => (p.has('vite-hmr') ? 'vite-hmr' : false) });
  await new Promise((r) => wss.once('listening', r));
  const received = [];
  const sockets = new Set();
  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (raw) => received.push(JSON.parse(String(raw))));
    ws.send(JSON.stringify({ type: 'connected' }));
  });
  return {
    wss,
    port: wss.address().port,
    received,
    sockets,
    events: (name) => received.filter((m) => m.type === 'custom' && m.event === name).map((m) => m.data),
    broadcast: (msg) => sockets.forEach((ws) => ws.send(JSON.stringify(msg))),
    close: () => new Promise((r) => { sockets.forEach((ws) => ws.terminate()); wss.close(() => r()); }),
  };
}

async function until(fn, ms = 2000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await sleep(5);
  }
}

function makeBridge(extra = {}) {
  const selects = [];
  const logs = [];
  const bridge = new Bridge({
    name: 'vscode-pcbjs',
    version: '9.9.9',
    createSocket: (url, protocol) => new WebSocket(url, protocol),
    editor: { select: (req) => selects.push(req), log: (m) => logs.push(m) },
    heartbeatMs: 60,
    cursorDebounceMs: 30,
    reconnectMinMs: 20,
    reconnectMaxMs: 80,
    ...extra,
  });
  return { bridge, selects, logs };
}

test('socketUrl maps wildcard hosts to localhost and brackets IPv6', () => {
  assert.equal(socketUrl({ port: 5209, root: '/x' }), 'ws://localhost:5209/');
  assert.equal(socketUrl({ port: 1, host: '0.0.0.0', root: '/x' }), 'ws://localhost:1/');
  assert.equal(socketUrl({ port: 1, host: '::1', root: '/x' }), 'ws://[::1]:1/');
  assert.equal(socketUrl({ port: 1, host: '127.0.0.1', root: '/x' }), 'ws://127.0.0.1:1/');
});

test('hello on connect, heartbeat, bye on disconnect', async () => {
  const srv = await mockServer();
  const { bridge } = makeBridge();
  const conn = bridge.upsert('/p/.pcbjs/dev.json', { port: srv.port, host: '127.0.0.1', root: '/p' });
  await until(() => srv.events('pcbjs:ide:hello').length >= 1);
  const h = srv.events('pcbjs:ide:hello')[0];
  assert.deepEqual([h.name, h.version, h.protocol, h.major], ['vscode-pcbjs', '9.9.9', 2, 1]);
  assert.ok(h.capabilities.includes('lsp'));
  assert.equal(conn.state, 'connected');
  await until(() => srv.events('pcbjs:ide:hello').length >= 3);
  bridge.remove('/p/.pcbjs/dev.json');
  await until(() => srv.events('pcbjs:ide:bye').length === 1);
  assert.equal(conn.state, 'disconnected');
  const n = srv.events('pcbjs:ide:hello').length;
  await sleep(150);
  assert.equal(srv.events('pcbjs:ide:hello').length, n, 'no heartbeat after disconnect');
  await srv.close();
});

test('cursor is debounced and filtered by root and extension, routed to the right server', async () => {
  const a = await mockServer();
  const b = await mockServer();
  const { bridge } = makeBridge();
  bridge.upsert('/a/.pcbjs/dev.json', { port: a.port, host: '127.0.0.1', root: '/work/a' });
  bridge.upsert('/b/.pcbjs/dev.json', { port: b.port, host: '127.0.0.1', root: '/work/a/nested' });
  await until(() => a.events('pcbjs:ide:hello').length && b.events('pcbjs:ide:hello').length);

  for (let i = 1; i <= 10; i++) bridge.cursor('/work/a/main.tsx', i, 2);
  await sleep(100);
  assert.deepEqual(a.events('pcbjs:ide:cursor'), [{ file: '/work/a/main.tsx', line: 10, col: 2 }]);

  bridge.cursor('/work/a/nested/lib/r.ts', 3, 4);
  await sleep(100);
  assert.deepEqual(b.events('pcbjs:ide:cursor'), [{ file: '/work/a/nested/lib/r.ts', line: 3, col: 4 }], 'deepest root wins');
  assert.equal(a.events('pcbjs:ide:cursor').length, 1);

  bridge.cursor('/work/a/readme.md', 1, 1);
  await sleep(60);
  bridge.cursor('/elsewhere/x.ts', 1, 1);
  await sleep(60);
  bridge.cursor('/work/ab/x.ts', 1, 1);
  await sleep(60);
  bridge.cursorSync = false;
  bridge.cursor('/work/a/main.tsx', 5, 5);
  await sleep(60);
  assert.equal(a.events('pcbjs:ide:cursor').length, 1);
  assert.equal(b.events('pcbjs:ide:cursor').length, 1);

  bridge.dispose();
  await a.close();
  await b.close();
});

test('select is applied through the editor interface; connected, ping and other HMR traffic are tolerated', async () => {
  const srv = await mockServer();
  const { bridge, selects } = makeBridge();
  bridge.upsert('k', { port: srv.port, host: '127.0.0.1', root: '/p' });
  await until(() => srv.events('pcbjs:ide:hello').length);
  srv.broadcast({ type: 'ping' });
  srv.broadcast({ type: 'full-reload', path: '*' });
  srv.broadcast({ type: 'custom', event: 'pcbjs:board', data: {} });
  srv.broadcast({ type: 'custom', event: 'pcbjs:ide:select', data: { file: '/p/main.tsx', line: 'x' } });
  const req = { file: '/p/main.tsx', line: 12, col: 5, endLine: 14, endCol: 9 };
  srv.broadcast({ type: 'custom', event: 'pcbjs:ide:select', data: req });
  await until(() => selects.length === 1);
  assert.deepEqual(selects[0], req);
  await until(() => srv.received.some((m) => m.type === 'pong'));
  bridge.dispose();
  await srv.close();
});

test('reconnects with backoff when the socket drops, and keeps trying while the server is down', async () => {
  const srv = await mockServer();
  const port = srv.port;
  const { bridge } = makeBridge();
  const conn = bridge.upsert('k', { port, host: '127.0.0.1', root: '/p' });
  await until(() => srv.events('pcbjs:ide:hello').length === 1);

  srv.sockets.forEach((ws) => ws.terminate());
  await until(() => srv.events('pcbjs:ide:hello').length >= 2 && conn.state === 'connected');

  await srv.close();
  await until(() => conn.state !== 'connected');
  await sleep(200);
  const srv2 = await mockServer(port);
  await until(() => srv2.events('pcbjs:ide:hello').length >= 1, 3000);
  assert.equal(conn.state, 'connected');
  bridge.dispose();
  await srv2.close();
});

test('upsert with a new port restarts the connection on the new server', async () => {
  const a = await mockServer();
  const b = await mockServer();
  const { bridge } = makeBridge();
  bridge.upsert('k', { port: a.port, host: '127.0.0.1', root: '/p', pid: 1 });
  await until(() => a.events('pcbjs:ide:hello').length);
  bridge.upsert('k', { port: b.port, host: '127.0.0.1', root: '/p', pid: 2 });
  await until(() => b.events('pcbjs:ide:hello').length && a.events('pcbjs:ide:bye').length);
  assert.equal(bridge.connections.size, 1);
  bridge.dispose();
  await a.close();
  await b.close();
});

test('pcbjs.followDevJson: on unless set to false, declared with its default, and pcbjs.connect follows once asked', async () => {
  const { followsDevJson } = await import('../dist/bridge.cjs')
  assert.equal(followsDevJson(undefined, false), true)
  assert.equal(followsDevJson(true, false), true)
  assert.equal(followsDevJson(false, false), false, 'off leaves servers started by hand alone')
  assert.equal(followsDevJson(false, true), true, 'the connect command still connects')
  const pkg = JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const p = pkg.contributes.configuration.properties['pcbjs.followDevJson']
  assert.deepEqual([p.type, p.default], ['boolean', true])
})

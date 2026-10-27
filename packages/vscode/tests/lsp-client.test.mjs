// The language client side against a mock language server: a mock dev server dials the real IdeHost and answers JSON-RPC on
// the same socket. The client is a vscode-jsonrpc connection over the extension's transports, standing in for
// vscode-languageclient, with a fake editor: the handshake options, the focus relay, a segment edit round trip, the
// preview following pcbjs/preview and a selection from the viewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { createMessageConnection, AbstractMessageReader, AbstractMessageWriter } from 'vscode-jsonrpc';
import { sleep, until } from './fake.mjs';

const require = createRequire(import.meta.url);
const { IdeHost } = require('../dist/host.cjs');
const { Sync } = require('../dist/sync.cjs');
const { PcbjsSession, transports, initializationOptions, CLIENT_KINDS } = require('../dist/lsp-client.cjs');

const FILE = '/work/p/pcb.tsx';
const URI = 'file:///work/p/pcb.tsx';
const TEXT = `route(a, b, 'V 14 Z')\n<J1 at="3 7" />\n`;

/** The mock dev server: dials the host, says ready, and runs a JSON-RPC server on the same socket, one message per frame. */
async function mockServer(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => (ws.once('open', ok), ws.once('error', fail)));
  ws.send(JSON.stringify({ event: 'pcbjs:ide:ready', data: { port: 5273, host: '127.0.0.1', urls: ['http://127.0.0.1:5273/'], root: '/work/p', pid: 7, version: '0.1.0' } }));
  let cb;
  const reader = new (class extends AbstractMessageReader { listen(c) { cb = c; return { dispose() {} }; } })();
  const writer = new (class extends AbstractMessageWriter { async write(m) { ws.send(JSON.stringify(m)); } end() {} })();
  const events = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.jsonrpc) cb?.(m);
    else events.push(m);
  });
  const conn = createMessageConnection(reader, writer);
  const seen = { init: null, focus: [] };
  conn.onRequest('initialize', (p) => {
    seen.init = p;
    return { capabilities: { experimental: { pcbjs: { protocol: 1, kinds: p.initializationOptions.pcbjs.kinds, methods: [], version: '0.1.0' } } } };
  });
  conn.onNotification('pcbjs/focus', (p) => seen.focus.push(p));
  // the segments of TEXT: the V command of the path, with one presentation and an answer for a typed value
  conn.onRequest('pcbjs/segments', (p) => {
    const range = { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } };
    const seg = { range, kind: 'pathCommand', value: 'V 14', label: 'route path, command 1', constraints: { grammar: 'route', index: 0 }, presentations: [{ label: 'H 14', edit: { range, newText: 'H 14' } }] };
    if (typeof p.value === 'string') return p.value.startsWith('C') ? [{ ...seg, presentations: [], error: 'a curve' }] : [{ ...seg, presentations: [{ label: p.value, edit: { range, newText: p.value } }] }];
    return [seg];
  });
  conn.listen();
  return { ws, conn, seen, events, close: () => ws.close() };
}

/** A fake editor: one document, edits applied to its text. */
function fakeEditor() {
  const ed = { text: TEXT, selects: [], previews: [] };
  ed.port = {
    select: (uri, range) => ed.selects.push({ uri, range }),
    preview: (url, scope) => ed.previews.push({ url, scope }),
    applyEdit: async (uri, edits) => {
      assert.equal(uri, URI);
      const lines = ed.text.split('\n');
      const off = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
      for (const e of [...edits].sort((a, b) => off(b.range.start) - off(a.range.start))) ed.text = ed.text.slice(0, off(e.range.start)) + e.newText + ed.text.slice(off(e.range.end));
      return true;
    },
    uri: (file) => `file://${file}`,
  };
  return ed;
}

async function setup() {
  let connected;
  const got = new Promise((r) => (connected = r));
  const host = new IdeHost({ name: 'vscode-pcbjs', version: '0.4.0', editor: { select() {} }, onConnect: (c) => c.root && connected(c) });
  const url = await host.listen();
  const server = await mockServer(url);
  const client = await got;
  const conn = createMessageConnection(...Object.values(transports(client)));
  conn.listen();
  const ed = fakeEditor();
  const session = new PcbjsSession(conn, ed.port);
  return { host, server, client, conn, ed, session, close: async () => { conn.dispose(); server.close(); await host.close(); } };
}

test('handshake: the client states its protocol and every kind it renders', async () => {
  const t = await setup();
  try {
    const res = await t.conn.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: initializationOptions('0.4.0') });
    assert.deepEqual(t.server.seen.init.initializationOptions, { pcbjs: { protocol: 2, major: 1, kinds: [...CLIENT_KINDS], capabilities: ['widget'], name: 'vscode-pcbjs', version: '0.4.0' } });
    assert.deepEqual(res.capabilities.experimental.pcbjs.kinds, ['number', 'length', 'angle', 'position', 'layer', 'enum', 'pathCommand', 'pinRef']);
    // JSON-RPC frames never reach the envelope handlers, and envelopes still work beside them
    assert.equal(t.client.info.root, '/work/p');
  } finally {
    await t.close();
  }
});

test('focus relay: the active file and the cursor go as pcbjs/focus', async () => {
  const t = await setup();
  try {
    await t.conn.sendRequest('initialize', { processId: null, capabilities: {}, initializationOptions: initializationOptions('0.4.0') });
    const sync = new Sync({ frameMs: 10, route: () => ({ root: '/work/p', send: (e, d) => t.session.relay(e, d) || t.client.send(e, d) }) });
    // the first move at once, the last of the frame after it
    sync.cursor(FILE, 2, 5);
    sync.cursor(FILE, 2, 6);
    await until(() => t.server.seen.focus.length >= 2);
    assert.deepEqual(t.server.seen.focus.map((f) => f.position), [{ line: 1, character: 4 }, { line: 1, character: 5 }]);
    assert.deepEqual(t.server.seen.focus.at(-1).textDocument, { uri: URI });
    assert.ok(sync.focus(FILE));
    await until(() => t.server.seen.focus.length >= 3);
    // a focus carries the last cursor in that file
    assert.deepEqual(t.server.seen.focus.at(-1).position, { line: 1, character: 5 });
    // leaving the design files: the file's start, which no range holds
    assert.ok(sync.leave());
    await until(() => t.server.seen.focus.length >= 4);
    assert.deepEqual(t.server.seen.focus.at(-1), { textDocument: { uri: URI }, position: { line: 0, character: 0 } });
    // no event went the old way
    await sleep(30);
    assert.equal(t.server.events.filter((m) => m.event === 'pcbjs:ide:focus' || m.event === 'pcbjs:ide:cursor').length, 0);
    sync.dispose();
  } finally {
    await t.close();
  }
});

test('segment edit round trip: a presentation and a typed value applied through the editor', async () => {
  const t = await setup();
  try {
    await t.conn.sendRequest('initialize', { processId: null, capabilities: {}, initializationOptions: initializationOptions('0.4.0') });
    const seg = await t.session.segmentAt(URI, { line: 0, character: 14 });
    assert.equal(seg.kind, 'pathCommand');
    assert.ok(await t.session.apply(URI, seg.presentations[0]));
    assert.equal(t.ed.text.split('\n')[0], "route(a, b, 'H 14 Z')");
    const typed = await t.session.typed(URI, seg.range.start, 'V 20');
    await t.session.apply(URI, typed.presentations[0]);
    assert.equal(t.ed.text.split('\n')[0], "route(a, b, 'V 20 Z')");
    const bad = await t.session.typed(URI, seg.range.start, 'C 1 2');
    assert.equal(bad.error, 'a curve');
    assert.equal((await t.session.segments(URI)).length, 1);
  } finally {
    await t.close();
  }
});

test('the preview follows pcbjs/preview and a viewer click arrives as pcbjs/select', async () => {
  const t = await setup();
  try {
    await t.conn.sendRequest('initialize', { processId: null, capabilities: {}, initializationOptions: initializationOptions('0.4.0') });
    await t.server.conn.sendNotification('pcbjs/preview', { url: 'http://127.0.0.1:5273/alpha/', scope: 'alpha' });
    await t.server.conn.sendNotification('pcbjs/select', { uri: URI, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 15 } } });
    await until(() => t.ed.previews.length && t.ed.selects.length);
    assert.deepEqual(t.ed.previews, [{ url: 'http://127.0.0.1:5273/alpha/', scope: 'alpha' }]);
    assert.deepEqual(t.ed.selects[0], { uri: URI, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 15 } } });
    // malformed notifications are ignored
    await t.server.conn.sendNotification('pcbjs/preview', { nope: 1 });
    await sleep(30);
    assert.equal(t.ed.previews.length, 1);
  } finally {
    await t.close();
  }
});

test('a closed connection closes the client transport', async () => {
  const t = await setup();
  let closed = false;
  t.conn.onClose(() => (closed = true));
  t.server.close();
  await until(() => closed);
  await t.host.close();
});

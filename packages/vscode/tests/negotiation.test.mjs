// Version negotiation from the extension's side: mock dev servers of older, current and future protocols dial the real host,
// and segments of a server with and without widgets reach the editor's widget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { until, sleep } from './fake.mjs';

const require = createRequire(import.meta.url);
const { IdeHost } = require('../dist/host.cjs');
const { PROTOCOL, MAJOR, CAPABILITIES, offers, tooNew, majorOf } = require('../dist/protocol.cjs');
const { initializationOptions, widgetOf, CLIENT_KINDS } = require('../dist/lsp-client.cjs');

async function dial(url) {
  const ws = new WebSocket(url);
  const received = [];
  ws.on('message', (raw) => received.push(JSON.parse(String(raw))));
  await new Promise((ok, fail) => (ws.once('open', ok), ws.once('error', fail)));
  return { ws, received, send: (event, data) => ws.send(JSON.stringify({ event, data })), close: () => ws.close() };
}

function makeHost() {
  const logs = [];
  const notices = [];
  const readies = [];
  const host = new IdeHost({
    name: 'vscode-pcbjs',
    version: '0.1.0',
    editor: { select: () => {}, log: (m) => logs.push(m) },
    onTooNew: (text, client) => notices.push({ text, client }),
    target: () => ({ onReady: (info) => readies.push(info), onBoards() {}, onLog() {}, onClosed() {} }),
  });
  return { host, logs, notices, readies };
}

const ready = (over = {}) => ({ port: 5301, host: '127.0.0.1', urls: ['http://127.0.0.1:5301/'], root: '/work/p', pid: 1, version: '0.0.1', ...over });

test('the hello states the protocol, the major and the capabilities, the language client options too', async () => {
  const { host } = makeHost();
  const c = await dial(await host.listen());
  await until(() => c.received.length);
  assert.deepEqual(c.received[0].data, { name: 'vscode-pcbjs', version: '0.1.0', protocol: PROTOCOL, major: MAJOR, capabilities: [...CAPABILITIES] });
  assert.ok(CAPABILITIES.includes('lsp') && CAPABILITIES.includes('widget'));
  const o = initializationOptions('0.1.0').pcbjs;
  assert.deepEqual([o.protocol, o.major, o.capabilities, o.kinds], [PROTOCOL, MAJOR, ['widget'], [...CLIENT_KINDS]]);
  c.close();
  await host.close();
});

test('a newer extension against an older server: a ready without protocol fields works, offers protocol 1, no notice', async () => {
  const { host, notices, readies } = makeHost();
  const c = await dial(await host.listen());
  c.send('pcbjs:ide:ready', ready());
  await until(() => readies.length);
  assert.equal(majorOf(readies[0]), 1);
  assert.ok(offers(readies[0], 'lsp'), 'a server from before capabilities is tried for a language server');
  assert.equal(notices.length, 0);
  // protocol 1 segments carry no widget: the editor infers one from the kind
  assert.deepEqual(widgetOf({ kind: 'length', constraints: {} }), { input: 'text', typed: true, options: undefined });
  assert.deepEqual(widgetOf({ kind: 'enum', constraints: { choices: ['F', 'B'] } }), { input: 'enum', typed: false, options: ['F', 'B'] });
  c.close();
  await host.close();
});

test('an older extension against a newer server: one notice with the fix, unknown events and kinds ignored silently', async () => {
  const { host, notices, logs, readies } = makeHost();
  const c = await dial(await host.listen());
  const info = ready({ version: '2.0.0', protocol: PROTOCOL + 3, major: MAJOR + 1, capabilities: ['cursor', 'focus', 'hologram'] });
  c.send('pcbjs:ide:ready', info);
  c.send('pcbjs:ide:hologram', { depth: 3 });
  c.send('pcbjs:ide:ready', info);
  await until(() => readies.length === 2);
  await sleep(30);
  assert.equal(notices.length, 1, 'once per connection');
  assert.match(notices[0].text, /speaks IDE protocol 2, this extension 1/);
  assert.match(notices[0].text, /pcbjs ide install/);
  assert.ok(!offers(readies[0], 'lsp'), 'a server that lists no lsp gets no language client');
  assert.ok(!logs.some((l) => /hologram/.test(l)), 'an unknown event leaves no trace');
  assert.equal(tooNew({ major: MAJOR }), undefined);
  // a segment of a kind this extension never heard of, with the widget its server sends
  const seg = { kind: 'colour', value: '#f00', label: 'silk colour', constraints: {}, presentations: [], widget: { input: 'swatch', typed: true, prompt: 'a CSS colour', preview: '#f00' } };
  assert.deepEqual(widgetOf(seg), seg.widget);
  assert.equal(widgetOf({ ...seg, widget: { input: 'enum', typed: false, options: ['red'] } }).typed, false);
  c.close();
  await host.close();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fakeSpawn, sleep, until } from './fake.mjs';

const require = createRequire(import.meta.url);
const { PcbjsServer, findBinary, findGlobal, launcher, devArgs } = require('../dist/server.cjs');
const { Sync } = require('../dist/sync.cjs');

const ROOT = path.resolve('/work/repo/examples/demo');
const BIN = path.resolve('/work/repo/node_modules/@pcbjs/pcbjs/bin/pcbjs.js');
const URL_ = 'ws://127.0.0.1:41234/tok';

function makeServer(extra = {}) {
  const { spawn, calls } = fakeSpawn(extra.child);
  const changes = [];
  const server = new PcbjsServer({
    folders: () => [ROOT],
    ideUrl: () => URL_,
    exists: (p) => p === BIN,
    nodePath: () => '/usr/bin/node',
    spawn,
    backoffMinMs: 20,
    backoffMaxMs: 80,
    killTimeoutMs: 100,
    onChange: () => changes.push(server.state.kind),
    ...extra,
  });
  return { server, calls, changes };
}

const readyFor = (child) => ({ port: 5301, host: '127.0.0.1', urls: ['http://127.0.0.1:5301/'], root: ROOT, pid: child.pid, version: '0.0.1' });
const fakeClient = () => ({ root: ROOT, send: () => true });

const DOTBIN = process.platform === 'win32' ? 'pcbjs.cmd' : 'pcbjs';

test('findBinary walks up from the folder to the nearest node_modules/.bin/pcbjs, then the package bin', () => {
  const seen = [];
  const exists = (p) => (seen.push(p), p === BIN);
  assert.equal(findBinary(ROOT, exists), BIN);
  assert.deepEqual(seen, [
    path.join(ROOT, 'node_modules/.bin', DOTBIN), path.join(ROOT, 'node_modules/@pcbjs/pcbjs/bin/pcbjs.js'),
    path.resolve('/work/repo/examples/node_modules/.bin', DOTBIN), path.resolve('/work/repo/examples/node_modules/@pcbjs/pcbjs/bin/pcbjs.js'),
    path.resolve('/work/repo/node_modules/.bin', DOTBIN), BIN,
  ]);
  const dot = path.resolve('/work/repo/node_modules/.bin', DOTBIN);
  assert.equal(findBinary(ROOT, (p) => p === dot || p === BIN), dot, '.bin first');
  assert.equal(findBinary(ROOT, () => false), undefined);
  const own = path.join(ROOT, 'node_modules/@pcbjs/pcbjs/bin/pcbjs.js');
  assert.equal(findBinary(ROOT, (p) => p === own || p === BIN), own, 'the nearest one wins');
});

test('spawn runs node <bin> dev --workspace <folders> --ide=<url> --port 0 --host 127.0.0.1 in the first folder', async () => {
  const OTHER = path.resolve('/work/other');
  const { server, calls } = makeServer({ folders: () => [ROOT, OTHER] });
  const lines = [];
  server['o'].output = (l) => lines.push(l);
  await server.start();
  assert.equal(calls.length, 1);
  const { command, args, options } = calls[0];
  assert.equal(command, '/usr/bin/node');
  assert.deepEqual(args, [BIN, 'dev', '--workspace', ROOT, OTHER, `--ide=${URL_}`, '--port', '0', '--host', '127.0.0.1']);
  assert.deepEqual(devArgs([ROOT], URL_), ['dev', '--workspace', ROOT, `--ide=${URL_}`, '--port', '0', '--host', '127.0.0.1']);
  assert.ok(server.contains(path.join(OTHER, 'a', 'pcb.tsx')) && !server.contains('/elsewhere/x.tsx'));
  assert.equal(options.cwd, ROOT);
  assert.equal(options.env.TERM_PROGRAM, process.env.TERM_PROGRAM);
  assert.ok(!lines.join('\n').includes('/tok'), 'the token is not echoed to the output channel');

  calls[0].child.stdout.write('\x1b[32m  VITE ready\x1b[0m\npartial');
  calls[0].child.stderr.write('oops\n');
  await until(() => server.lines.includes('oops'));
  assert.ok(server.lines.includes('  VITE ready'), 'ANSI stripped, one line per line');

  assert.equal(server.state.kind, 'starting');
  server.onReady(readyFor(calls[0].child), fakeClient());
  assert.deepEqual(server.state, { kind: 'running', url: 'http://127.0.0.1:5301/', info: readyFor(calls[0].child) });
  await server.start();
  assert.equal(calls.length, 1, 'start while running is a no-op');
  await server.stop();
});

test('the .bin link runs under the chosen node, a shell shim as it is, a global pcbjs only with a notice', async () => {
  const real = path.resolve('/work/repo/node_modules/@pcbjs/pcbjs/bin/pcbjs.js');
  const dot = path.resolve('/work/repo/node_modules/.bin/pcbjs');
  assert.deepEqual(launcher(dot, '/n/node', () => real), { command: '/n/node', args: [real], shell: false });
  assert.deepEqual(launcher(dot, '/n/node', (p) => p), { command: dot, args: [], shell: false });
  assert.deepEqual(launcher('C:\\p\\pcbjs.cmd', 'node', (p) => p), { command: 'C:\\p\\pcbjs.cmd', args: [], shell: true });

  const a = makeServer({ exists: (p) => p === dot, realpath: () => real });
  await a.server.start();
  assert.equal(a.calls[0].command, '/usr/bin/node');
  assert.equal(a.calls[0].args[0], real);
  await a.server.stop();

  const glob = path.join(path.resolve('/opt/g/bin'), DOTBIN);
  assert.equal(findGlobal({ PATH: ['/x', '/opt/g/bin'].map((d) => path.resolve(d)).join(path.delimiter) }, (p) => p === glob), glob);
  const notices = [];
  const b = makeServer({ exists: (p) => p === glob, realpath: (p) => p, env: { PATH: path.resolve('/opt/g/bin') }, onGlobal: (bin) => notices.push(bin) });
  await b.server.start();
  assert.equal(b.calls[0].command, glob);
  assert.equal(b.calls[0].args[0], 'dev');
  assert.deepEqual(notices, [glob]);
  b.calls[0].child.exit(1);
  await until(() => b.calls.length === 2);
  assert.deepEqual(notices, [glob], 'one notice, not one per restart');
  await b.server.stop();
});

test('restart on crash with exponential backoff, give up after maxRestarts, a ready resets the count', async () => {
  const { server, calls } = makeServer({ maxRestarts: 3 });
  await server.start();
  calls[0].child.exit(1);
  await until(() => calls.length === 2);
  assert.deepEqual(server.state, { kind: 'starting', attempt: 1 });
  // A ready in between means the next crash starts again from the shortest delay.
  server.onReady(readyFor(calls[1].child), fakeClient());
  calls[1].child.exit(1);
  await until(() => calls.length === 3);
  for (let i = 3; i <= 5; i++) {
    calls[i - 1].child.exit(1);
    if (i <= 5 && server.state.kind !== 'failed') await until(() => calls.length === i + 1 || server.state.kind === 'failed');
  }
  await until(() => server.state.kind === 'failed');
  assert.match(server.state.reason, /exited 4 times in a row/);
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  // crash 1: 20 ms; ready resets; crashes 1, 2, 3: 20, 40, 80 ms; the 4th gives up.
  assert.equal(calls.length, 5);
  assert.ok(gaps[0] >= 18 && gaps[1] >= 18 && gaps[2] >= 38 && gaps[3] >= 75, `gaps ${gaps}`);
  await assert.rejects(server.whenReady(), /exited 4 times/);
  await sleep(150);
  assert.equal(calls.length, 5, 'no restart after failing');

  await server.start();
  assert.equal(calls.length, 6, 'start after failed launches again');
  await server.stop();
});

test('stop kills the child with SIGTERM, then SIGKILL when it hangs, and never restarts', async () => {
  const { server, calls } = makeServer();
  await server.start();
  const child = calls[0].child;
  const waiting = assert.rejects(server.whenReady(), /stopped/);
  await server.stop();
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.ok(child.exited);
  assert.equal(server.state.kind, 'stopped');
  await waiting;
  await sleep(60);
  assert.equal(calls.length, 1);

  const hung = makeServer({ child: { obeysTerm: false } });
  await hung.server.start();
  const t0 = Date.now();
  await hung.server.stop();
  assert.deepEqual(hung.calls[0].child.signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(Date.now() - t0 >= 90);
  assert.equal(hung.calls.length, 1);
});

test('failures: no binary, node not runnable, no ready in time', async () => {
  const a = makeServer({ exists: () => false });
  await a.server.start();
  assert.equal(a.server.state.kind, 'failed');
  assert.equal(a.server.state.hint, 'install');
  assert.match(a.server.state.reason, /npm install --save-dev @pcbjs\/pcbjs/);
  assert.equal(a.calls.length, 0);

  // a pcbjs installed in a project of the workspace, below the folders, is found through the candidates
  const inner = path.resolve('/work/top/proj/node_modules/@pcbjs/pcbjs/bin/pcbjs.js');
  const b = makeServer({ folders: () => [path.resolve('/work/top')], candidates: () => [path.resolve('/work/top/proj')], exists: (p) => p === inner });
  await b.server.start();
  assert.equal(b.calls[0].args[0], inner);
  await b.server.stop();

  const c = makeServer();
  await c.server.start();
  const err = Object.assign(new Error('spawn /usr/bin/node ENOENT'), { code: 'ENOENT' });
  c.calls[0].child.emit('error', err);
  assert.equal(c.server.state.hint, 'node');

  const d = makeServer({ readyTimeoutMs: 50 });
  await d.server.start();
  await until(() => d.server.state.kind === 'failed');
  assert.match(d.server.state.reason, /did not report ready/);
  await until(() => d.calls[0].child.exited);
  assert.deepEqual(d.calls[0].child.signals, ['SIGTERM']);
  assert.equal(d.server.recent(2).length, 2);
});

test('sync sends the first cursor at once and the last of each frame, sends focus once per file and routes by root', async () => {
  const sent = [];
  const targets = [
    { root: '/work/a', send: (e, d) => (sent.push(['a', e, d]), true) },
    { root: '/work/a/nested', send: (e, d) => (sent.push(['n', e, d]), true) },
  ];
  const sync = new Sync({ frameMs: 30, route: (f) => targets.filter((t) => f.startsWith(t.root + '/')).sort((x, y) => y.root.length - x.root.length)[0] });
  for (let i = 1; i <= 10; i++) sync.cursor('/work/a/main.tsx', i, 2);
  assert.deepEqual(sent, [['a', 'pcbjs:ide:cursor', { file: '/work/a/main.tsx', line: 1, col: 2 }]], 'the first move goes at once');
  await sleep(70);
  assert.deepEqual(sent.slice(1), [['a', 'pcbjs:ide:cursor', { file: '/work/a/main.tsx', line: 10, col: 2 }]], 'the last of the frame follows');
  sent.length = 0;
  assert.ok(sync.focus('/work/a/nested/x.ts'));
  assert.ok(!sync.focus('/work/a/nested/x.ts'), 'the same focus is not repeated');
  assert.ok(!sync.focus('/work/a/readme.md'));
  assert.ok(!sync.focus('/elsewhere/x.tsx'));
  sync.resetFocus();
  assert.ok(sync.focus('/work/a/nested/x.ts'));
  sync.followFocus = false;
  assert.ok(!sync.focus('/work/a/main.tsx'));
  sync.cursorSync = false;
  sync.cursor('/work/a/main.tsx', 1, 1);
  await sleep(50);
  assert.deepEqual(sent, [['n', 'pcbjs:ide:focus', { file: '/work/a/nested/x.ts' }], ['n', 'pcbjs:ide:focus', { file: '/work/a/nested/x.ts' }]]);
  sync.dispose();
});

test('sync: a held key streams one cursor per frame, and leaving the design files clears at once', async () => {
  const sent = [];
  const t0 = performance.now();
  const target = { root: '/work/a', send: (e, d) => (sent.push({ e, d, t: performance.now() - t0 }), true) };
  const sync = new Sync({ route: (f) => (f.startsWith('/work/a/') ? target : undefined) });
  // an arrow key held for 600 ms, one move every 30 ms: the moves stream, the first at once, none held back past a frame or two
  for (let i = 1; i <= 20; i++) {
    sync.cursor('/work/a/main.tsx', i, 4);
    await sleep(30);
  }
  await sleep(40);
  assert.ok(sent.length >= 10, `${sent.length} sends`);
  assert.ok(sent[0].t < 5, `first after ${sent[0].t} ms`);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].t - sent[i - 1].t < 100, `gap ${sent[i].t - sent[i - 1].t} ms`);
  assert.equal(sent.at(-1).d.line, 20);
  // a markdown file, or an editor that is no file, gets focus: 1:1 of the last design file goes out at once, and only once
  sent.length = 0;
  sync.cursor('/work/a/README.md', 3, 3);
  assert.deepEqual(sent.map((s) => [s.e, s.d]), [['pcbjs:ide:cursor', { file: '/work/a/main.tsx', line: 1, col: 1 }]]);
  assert.ok(!sync.leave(), 'nothing to clear twice');
  assert.equal(sent.length, 1);
  // a pending cursor dies with the leave, so it cannot bring the highlight back
  sync.cursor('/work/a/main.tsx', 5, 5);
  sync.cursor('/work/a/main.tsx', 6, 5);
  assert.ok(sync.leave());
  await sleep(40);
  assert.deepEqual(sent.slice(1).map((s) => s.d), [{ file: '/work/a/main.tsx', line: 5, col: 5 }, { file: '/work/a/main.tsx', line: 1, col: 1 }]);
  sync.dispose();
});

test('sync sends close for a closed .ts or .tsx file under a root, and the next focus of it goes out again', () => {
  const sent = [];
  const targets = [{ root: '/work/a', send: (e, d) => (sent.push([e, d]), true) }];
  const sync = new Sync({ route: (f) => targets.find((t) => f.startsWith(t.root + '/')) });
  assert.ok(sync.focus('/work/a/lib/Part.tsx'));
  assert.ok(sync.close('/work/a/lib/Part.tsx'));
  assert.ok(!sync.close('/work/a/README.md'), 'only .ts and .tsx');
  assert.ok(!sync.close('/elsewhere/x.ts'), 'only under a root');
  assert.ok(sync.focus('/work/a/lib/Part.tsx'), 'a reopened file is focused again');
  assert.deepEqual(sent, [
    ['pcbjs:ide:focus', { file: '/work/a/lib/Part.tsx' }],
    ['pcbjs:ide:close', { file: '/work/a/lib/Part.tsx' }],
    ['pcbjs:ide:focus', { file: '/work/a/lib/Part.tsx' }],
  ]);
  sync.dispose();
});

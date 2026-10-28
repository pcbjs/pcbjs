// The create, convert and skills commands against the fake editor and a fake spawn: discovery, eligibility, the CLI each runs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FakeChild } from './fake.mjs';
import { ui, vscode } from './vscode.mjs';

const require = createRequire(import.meta.url);
const { kicadProjects, importDest, defaultProjectDir, projectDirError, destError, pcbjsRunner, nodeTool, createProject, convertKicad, installSkills, KICAD_EXCLUDE } = require('../dist/setup.cjs');

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pcbjs-setup-')));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const dir = (...files) => {
  const d = path.join(tmp, `w${n++}`);
  mkdirSync(d, { recursive: true });
  for (const f of files) touch(path.join(d, f), f.endsWith('package.json') ? '{"name":"@pcbjs/skills","exports":{"./*":"./*"}}' : '');
  return d;
};
const touch = (f, text = '') => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};
const BIN = 'node_modules/@pcbjs/pcbjs/bin/pcbjs.js';
const SKILLS = 'node_modules/@pcbjs/skills/package.json';

function reset(folders = [], files = []) {
  Object.assign(ui, { answers: [], calls: [], folders, files, clipboard: [] });
}
const answers = (...a) => ui.answers.push(...a);
const calls = (kind) => ui.calls.filter((c) => c.kind === kind);

/** A spawn whose children print the lines and exit with the code the script returns for each call. */
function spawner(script = () => ({})) {
  const runs = [];
  const spawn = (command, args, options) => {
    const child = new FakeChild();
    const call = { command, args, cwd: options.cwd, env: options.env };
    runs.push(call);
    setImmediate(() => {
      const { lines = [], code = 0 } = script(call) ?? {};
      for (const l of lines) child.stdout.write(`${l}\n`);
      child.exit(code);
    });
    return child;
  };
  return { spawn, runs };
}

function host(spawn, dirs = []) {
  const h = { lines: [], done: [], shown: 0, spawn, env: { PATH: '' } };
  Object.assign(h, { output: (l) => h.lines.push(l), showOutput: () => h.shown++, nodePath: () => process.execPath, projectDirs: () => dirs, opened: async (d, f) => void h.done.push([d, f]) });
  return h;
}

test('KiCad projects: convertible when the .kicad_pcb of the same name is beside, sorted with those first', () => {
  const w = dir('b/b.kicad_pro', 'a/a.kicad_pro', 'a/a.kicad_pcb', 'c/c.kicad_pro', 'c/other.kicad_pcb');
  const found = kicadProjects(['b/b', 'c/c', 'a/a'].map((p) => path.join(w, `${p}.kicad_pro`)));
  assert.deepEqual(found.map((p) => [path.relative(w, p.pro), p.skip ?? 'ok']), [
    ['a/a.kicad_pro', 'ok'],
    ['b/b.kicad_pro', 'no b.kicad_pcb beside it'],
    ['c/c.kicad_pro', 'no c.kicad_pcb beside it'],
  ]);
  assert.equal(found[0].pcb, path.join(w, 'a', 'a.kicad_pcb'));
  assert.equal(importDest(found[0], [w]), path.join(w, 'a-pcbjs'), 'beside the project folder');
  assert.equal(importDest(found[0], [path.join(w, 'a')]), path.join(w, 'a', 'a-pcbjs'), 'inside a project folder that is a workspace root');
});

test('folder names: the defaults and what create and import would refuse', () => {
  const w = dir('board/x', 'full/x', 'file');
  assert.equal(defaultProjectDir(dir()), '.');
  assert.equal(defaultProjectDir(w), 'board-2');
  assert.equal(projectDirError(w, ' '), 'Give a folder name, or . for the folder itself');
  assert.match(projectDirError(w, 'full'), /not empty/);
  assert.match(projectDirError(w, 'file'), /is a file/);
  assert.equal(projectDirError(w, 'new'), undefined);
  touch(path.join(w, 'done', 'pcb.tsx'));
  assert.match(destError(w, 'done'), /already holds a pcb.tsx/);
  assert.equal(destError(w, 'full'), undefined);
});

test('the pcbjs that runs: the nearest install, else a global one, else npx', () => {
  const w = dir(BIN);
  const sub = path.join(w, 'p');
  assert.deepEqual(pcbjsRunner([sub], '/n/node', {}), { command: '/n/node', args: [path.join(w, BIN)], shell: false });
  const bare = dir();
  const glob = dir('pcbjs');
  assert.deepEqual(pcbjsRunner([bare], '/n/node', { PATH: glob }).command, path.join(glob, 'pcbjs'));
  assert.deepEqual(pcbjsRunner([bare], 'node', { PATH: '' }), { command: 'npx', args: ['--yes', '--package', '@pcbjs/pcbjs', 'pcbjs'], shell: false });
  const nodeDir = dir('npm');
  assert.equal(nodeTool(path.join(nodeDir, 'node'), 'npm', ['install']).command, path.join(nodeDir, 'npm'));
});

test('create: one folder, the default name, the workspace pcbjs, then the board file and the preview', async () => {
  const root = dir(BIN);
  reset([root]);
  answers(['input', (o) => o.value]);
  const { spawn, runs } = spawner((c) => {
    touch(path.join(c.cwd, c.args.at(-1), 'pcb.tsx'));
    return { lines: ['pcbjs: created the board board in board from the board template'] };
  });
  const h = host(spawn);
  assert.equal(await createProject(h), path.join(root, 'board'));
  assert.equal(calls('pick').length + calls('open').length, 0, 'no folder question with one root');
  assert.equal(calls('input')[0].value, 'board');
  assert.deepEqual(runs.map((r) => [r.command, ...r.args]), [[process.execPath, path.join(root, BIN), 'create', 'board']]);
  assert.equal(runs[0].cwd, root);
  assert.equal(runs[0].env.NO_COLOR, '1');
  assert.deepEqual(h.done, [[path.join(root, 'board'), path.join(root, 'board', 'pcb.tsx')]]);
  assert.deepEqual(calls('progress')[0].reported, ['pcbjs: created the board board in board from the board template']);
});

test('create: several folders ask which; no folder opens a dialog, runs npx and installs the packages', async () => {
  const [a, b] = [dir(BIN), dir(BIN)];
  reset([a, b]);
  answers(['pick', (o) => o.items[1]], ['input', 'mine']);
  const one = spawner((c) => void touch(path.join(c.cwd, 'mine', 'pcb.tsx')));
  assert.equal(await createProject(host(one.spawn)), path.join(b, 'mine'));
  assert.deepEqual(calls('pick')[0].items.map((i) => i.dir), [a, b]);

  const empty = dir();
  reset([]);
  answers(['open', [vscode.Uri.file(empty)]], ['input', (o) => o.value]);
  const two = spawner((c) => {
    if (c.args.includes('create')) touch(path.join(empty, 'pcb.tsx'));
    else touch(path.join(c.cwd, BIN));
  });
  const h = host(two.spawn);
  assert.equal(await createProject(h), empty);
  assert.equal(calls('open')[0].canSelectFolders, true);
  assert.equal(calls('input')[0].value, '.', 'an empty folder takes the project itself');
  assert.deepEqual(two.runs.map((r) => [path.basename(r.command), ...r.args]), [
    ['npx', '--yes', '--package', '@pcbjs/pcbjs', 'pcbjs', 'create', '.'],
    ['npm', 'install'],
  ]);
  assert.equal(two.runs[1].cwd, empty);
  assert.ok(two.runs[0].env.PATH.startsWith(path.dirname(process.execPath)), 'npx finds the node of pcbjs.nodePath');
  assert.deepEqual(h.done, [[empty, path.join(empty, 'pcb.tsx')]]);
});

test('create: a failing CLI shows its last line and opens nothing', async () => {
  const root = dir(BIN);
  reset([root]);
  answers(['input', 'x'], ['error', 'Show output']);
  const { spawn } = spawner(() => ({ lines: ['pcbjs: x is not empty; give a new or empty directory'], code: 1 }));
  const h = host(spawn);
  assert.equal(await createProject(h), undefined);
  assert.equal(calls('error')[0].text, 'pcbjs: creating x failed: pcbjs: x is not empty; give a new or empty directory');
  await new Promise((r) => setImmediate(r));
  assert.equal(h.shown, 1);
  assert.deepEqual(h.done, []);
});

test('convert: several projects listed by path with the board beside, the first convertible active, import board into the sibling folder', async () => {
  const w = dir(BIN, 'hw/amp/amp.kicad_pro', 'hw/amp/amp.kicad_pcb', 'hw/old/old.kicad_pro');
  reset([w], [path.join(w, 'hw/old/old.kicad_pro'), path.join(w, 'hw/amp/amp.kicad_pro')]);
  let shown;
  answers(['quickPick', (o) => ((shown = o), 'active')], ['input', (o) => o.value]);
  const { spawn, runs } = spawner((c) => void touch(path.join(c.cwd, 'pcb.tsx')));
  const h = host(spawn);
  const dest = path.join(w, 'hw', 'amp-pcbjs');
  assert.equal(await convertKicad(h), dest);
  assert.deepEqual(calls('findFiles')[0], { kind: 'findFiles', glob: '**/*.kicad_pro', exclude: KICAD_EXCLUDE });
  assert.match(KICAD_EXCLUDE, /node_modules/);
  assert.match(KICAD_EXCLUDE, /\.pcbjs/);
  assert.deepEqual(shown.items.map((i) => [i.label, i.detail]), [
    ['$(circuit-board) hw/amp/amp.kicad_pro', 'hw/amp/amp.kicad_pcb'],
    ['$(circle-slash) hw/old/old.kicad_pro', 'skipped: no old.kicad_pcb beside it'],
  ]);
  assert.equal(shown.active[0], shown.items[0]);
  assert.equal(shown.placeholder, 'Convert which KiCad project?');
  assert.equal(calls('input')[0].value, dest);
  assert.deepEqual(runs.map((r) => [r.cwd, ...r.args.slice(1)]), [[dest, 'import', 'board', path.join(w, 'hw/amp/amp.kicad_pcb'), '-o', 'pcb.tsx']]);
  assert.deepEqual(h.done, [[dest, path.join(dest, 'pcb.tsx')]]);
  assert.match(calls('info')[0].text, /converted amp into hw\/amp-pcbjs/);
});

test('convert: one project is preselected to confirm; an ineligible pick says why; none opens a dialog', async () => {
  const w = dir(BIN, 'solo/solo.kicad_pro', 'solo/solo.kicad_pcb', 'bad/bad.kicad_pro');
  reset([w], [path.join(w, 'solo/solo.kicad_pro')]);
  let shown;
  answers(['quickPick', (o) => ((shown = o), undefined)]);
  assert.equal(await convertKicad(host(spawner().spawn)), undefined, 'dismissed');
  assert.equal(shown.items.length, 1);
  assert.equal(shown.active[0], shown.items[0]);
  assert.equal(shown.placeholder, 'Convert this KiCad project?');

  reset([w], [path.join(w, 'bad/bad.kicad_pro')]);
  answers(['quickPick', (o) => o.items[0]]);
  const s = spawner();
  assert.equal(await convertKicad(host(s.spawn)), undefined);
  assert.equal(calls('warning')[0].text, "pcbjs: bad/bad.kicad_pro is skipped: no bad.kicad_pcb beside it. pcbjs import board reads the .kicad_pcb of the project's name.");
  assert.equal(s.runs.length, 0);

  reset([w], []);
  answers(['open', [vscode.Uri.file(path.join(w, 'solo/solo.kicad_pro'))]], ['input', 'out']);
  const t = spawner((c) => void touch(path.join(c.cwd, 'pcb.tsx')));
  assert.equal(await convertKicad(host(t.spawn)), path.join(w, 'solo', 'out'), 'relative to the KiCad folder');
  assert.deepEqual(calls('open')[0].filters, { 'KiCad project': ['kicad_pro'] });
  assert.ok(existsSync(path.join(w, 'solo', 'out')));
});

test('skills: the project pcbjs runs skills install and its lines are shown', async () => {
  const p = dir(BIN, SKILLS);
  reset([p]);
  const { spawn, runs } = spawner(() => ({ lines: ['pcbjs-basics  link .agents/skills/pcbjs-basics', 'pcbjs-upgrade  link .agents/skills/pcbjs-upgrade'] }));
  const res = await installSkills(host(spawn, [p]));
  assert.equal(res.code, 0);
  assert.deepEqual(runs.map((r) => [r.cwd, ...r.args]), [[p, path.join(p, BIN), 'skills', 'install']]);
  assert.match(calls('info')[0].text, /skills in .*: pcbjs-basics {2}link .agents\/skills\/pcbjs-basics; pcbjs-upgrade/);
});

test('skills: several projects ask which; without @pcbjs/skills the npx route is offered', async () => {
  const [a, b] = [dir(BIN, SKILLS), dir(BIN)];
  reset([tmp]);
  answers(['pick', (o) => o.items.find((i) => i.dir === b)], ['warning', 'Copy command']);
  const s = spawner();
  assert.equal(await installSkills(host(s.spawn, [a, b])), undefined);
  assert.match(calls('warning')[0].text, /@pcbjs\/skills does not resolve, so pcbjs skills install cannot run. `npx @pcbjs\/skills install` copies/);
  assert.deepEqual(calls('warning')[0].actions, ['Run npx', 'Copy command']);
  assert.deepEqual(ui.clipboard, ['npx @pcbjs/skills install']);
  assert.equal(s.runs.length, 0);

  const bare = dir();
  reset([bare]);
  answers(['warning', 'Run npx']);
  const t = spawner(() => ({ lines: ['pcbjs-basics  copy .agents/skills/pcbjs-basics'] }));
  await installSkills(host(t.spawn, []));
  assert.match(calls('warning')[0].text, /pcbjs is not installed/);
  assert.deepEqual(t.runs.map((r) => [path.basename(r.command), r.cwd, ...r.args]), [['npx', bare, '--yes', '@pcbjs/skills', 'install']]);
});

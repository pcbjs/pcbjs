// The file icon mapping: config entries, the fixed and found associations, the theme over Seti and the settings of the
// third party icon themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const m = require('../dist/icon-map.cjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('entries: the literals of the config list, comments ignored, globs kept', () => {
  const src = `export default defineConfig({\n  // entries: ['old.tsx'],\n  entries: ['blinky.pcb.tsx', "boards/*.tsx"], // the boards\n})`;
  assert.deepEqual(m.configEntries(src), ['blinky.pcb.tsx', 'boards/*.tsx']);
  assert.deepEqual(m.configEntries('export default {}'), []);
  assert.ok(m.isGlob('boards/*.tsx') && !m.isGlob('pcb.tsx'));
});

test('fixed: config names, the entry and schematic suffixes, lib/ before them, the fab folder', () => {
  const a = m.fixedAssociations();
  assert.equal(a.fileNames['pcb.config.ts'], 'config');
  assert.equal(a.fileNames['pcbjs.config.mjs'], 'config');
  assert.equal(a.fileNames['pcb.tsx'], 'entry');
  assert.deepEqual(Object.entries(a.fileExtensions), [['lib/ts', 'footprint'], ['lib/tsx', 'footprint'], ['pcb.tsx', 'entry'], ['sch.ts', 'schematic'], ['sch.tsx', 'schematic']]);
  assert.deepEqual(a.folderNames, { '.pcbjs/fab': 'fab' });
});

test('found: by folder and name; an entry wins over a footprint, a config or schematic keeps its own icon', () => {
  const a = m.foundAssociations({
    entries: ['/p/main.tsx', '/p/lib/board.tsx', '/p/top.sch.tsx'],
    footprints: ['/p/lib/MyPart.tsx', '/p/lib/board.tsx'],
    fabDirs: ['/p/.pcbjs/fab/Blinky'],
    zips: ['/p/.pcbjs/fab/Blinky/Blinky-fab-0.1.0.zip'],
  });
  assert.deepEqual(a.fileNames, { 'lib/MyPart.tsx': 'footprint', 'lib/board.tsx': 'entry', 'p/main.tsx': 'entry', 'Blinky/Blinky-fab-0.1.0.zip': 'fab' });
  assert.deepEqual(a.folderNames, { 'fab/Blinky': 'fab' });
});

test('theme: Seti kept, the pcbjs icons on top in dark and light', () => {
  const seti = { fonts: [{ id: 'seti' }], iconDefinitions: { _ts: { fontCharacter: 'x' } }, file: '_default', fileExtensions: { tsx: '_ts' }, fileNames: { 'package.json': '_npm' }, light: { fileExtensions: { tsx: '_ts_light' } } };
  const t = m.iconTheme(seti, m.fixedAssociations());
  assert.deepEqual(t.fonts, seti.fonts);
  assert.equal(t.file, '_default');
  assert.equal(t.fileExtensions.tsx, '_ts');
  assert.equal(t.fileNames['package.json'], '_npm');
  assert.equal(t.fileNames['pcb.tsx'], '_pcbjs_entry');
  assert.equal(t.light.fileNames['pcb.tsx'], '_pcbjs_entry_light');
  assert.equal(t.light.fileExtensions.tsx, '_ts_light');
  assert.equal(t.folderNames, undefined);
  assert.deepEqual(t.iconDefinitions._pcbjs_entry, { iconPath: '../icons/tree/dark/entry.svg' });
  assert.deepEqual(t.iconDefinitions._pcbjs_entry_light, { iconPath: '../icons/tree/light/entry.svg' });
});

test('Material Icon Theme and vscode-icons: suffixes as *.ext or extensions, names as names, the folder by name', () => {
  const a = m.mergeAssociations(m.fixedAssociations(), m.foundAssociations({ entries: ['/p/main.tsx'], footprints: [], fabDirs: [], zips: [] }));
  const mat = m.materialSettings(a, (i) => `../../x/${i}`, '../../x/folder-pcbjs-fab');
  const files = mat['material-icon-theme.files.associations'];
  assert.equal(files['*.pcb.tsx'], '../../x/entry');
  assert.equal(files['*.sch.ts'], '../../x/schematic');
  assert.equal(files['pcb.config.ts'], '../../x/config');
  assert.equal(files['p/main.tsx'], '../../x/entry');
  assert.ok(!Object.keys(files).some((k) => k.startsWith('*.lib')));
  assert.deepEqual(mat['material-icon-theme.folders.associations'], { fab: '../../x/folder-pcbjs-fab' });
  const vs = m.vsiconsSettings(a);
  assert.deepEqual(vs.files.find((e) => e.icon === 'pcbjs_entry' && !e.filename).extensions, ['pcb.tsx']);
  assert.deepEqual(vs.files.find((e) => e.icon === 'pcbjs_entry' && e.filename).extensions, ['pcb.tsx', 'main.tsx']);
  assert.deepEqual(vs.folders, [{ icon: 'pcbjs_fab', extensions: ['fab'], format: 'svg' }]);
});

test('theme: every root property of the Seti source kept, file maps only grown, no folder icons that would shift the rows', (t) => {
  const file = [join(root, 'assets/icon-theme/seti.json'), join(root, '../../node_modules/.cache/pcbjs-seti/1.105.0/vs-seti-icon-theme.json')].find(existsSync);
  if (!file) return t.skip('no Seti source; npm run package -w @pcbjs/vscode fetches it');
  const seti = JSON.parse(readFileSync(file, 'utf8'));
  const found = m.foundAssociations({ entries: ['/p/main.tsx'], footprints: [], fabDirs: ['/p/.pcbjs/fab/Blinky'], zips: ['/p/.pcbjs/fab/Blinky/blinky.zip'] });
  const theme = m.iconTheme(seti, m.mergeAssociations(m.fixedAssociations(), found));
  assert.deepEqual(Object.keys(theme).sort(), Object.keys(seti).sort());
  const grown = ['iconDefinitions', 'fileExtensions', 'fileNames', 'light'];
  for (const k of Object.keys(seti)) if (!grown.includes(k)) assert.deepEqual(theme[k], seti[k], k);
  for (const k of grown) for (const [name, v] of Object.entries(seti[k])) if (typeof v !== 'object' || k !== 'light') assert.deepEqual(theme[k][name], v, `${k} ${name}`);
  assert.deepEqual(Object.keys(theme.light).sort(), Object.keys(seti.light).sort());
  assert.ok(!('folder' in theme) && !('folderNames' in theme) && !('folderNamesExpanded' in theme) && !('folderNames' in theme.light));
});

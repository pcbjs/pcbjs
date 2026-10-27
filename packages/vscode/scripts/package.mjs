// Packages the VSIX into packages/cli/vscode so it ships inside the @pcbjs/cli npm package; the same file goes to the Marketplace.
// The npm name is @pcbjs/vscode, which is not a valid extension name, so vsce runs on a staged copy whose manifest keeps the
// extension name vscode-pcbjs, so the VS Code identifier stays pcbjs.vscode-pcbjs, and the version extensionVersion maps.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The extension name VS Code knows; with the publisher it makes the identifier. */
const EXTENSION = 'vscode-pcbjs';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(here, '../cli/vscode');
const stage = join(here, '.vsix-stage');
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const version = extensionVersion(pkg.version);
const preRelease = pkg.version.includes('-');
const file = `${EXTENSION}-${version}.vsix`;
const stable = `${EXTENSION}.vsix`;
mkdirSync(out, { recursive: true });

// the staged manifest: the extension name, no npm `files` or `exports`, since vsce takes its file list from .vscodeignore,
// no scripts, since `npm run package` has built dist already and the stage has no sources to build from, and no dev
// dependencies, so that vsce's `npm list` sees only the staged plugin
const { files: _files, exports: _exports, scripts: _scripts, devDependencies: _dev, ...manifestPkg } = pkg;
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'dist'), { recursive: true });
writeFileSync(join(stage, 'package.json'), JSON.stringify({ ...manifestPkg, name: EXTENSION, version }, null, 2) + '\n');
for (const f of ['README.md', '.vscodeignore', 'dist/extension.js']) copyFileSync(join(here, f), join(stage, f));
if (!existsSync(join(here, 'assets/icon-theme/pcbjs.json'))) throw new Error('assets/icon-theme is missing: run node scripts/icon-theme.mjs');
cpSync(join(here, 'assets'), join(stage, 'assets'), { recursive: true });
// the TypeScript plugin, which tsserver finds as node_modules/@pcbjs/ts-plugin beside the extension
const plugin = resolve(here, '../ts-plugin');
execFileSync(process.execPath, [join(plugin, 'scripts/bundle.mjs')], { stdio: 'inherit' });
const staged = join(stage, 'node_modules/@pcbjs/ts-plugin');
mkdirSync(join(staged, 'dist'), { recursive: true });
copyFileSync(join(plugin, 'package.json'), join(staged, 'package.json'));
copyFileSync(join(plugin, 'dist/index.cjs'), join(staged, 'dist/index.cjs'));

const manifest = { name: EXTENSION, publisher: pkg.publisher, version, train: pkg.version, preRelease, id: `${pkg.publisher}.${EXTENSION}`, file };
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const npx = join(dirname(process.execPath), 'npx');
try {
  execFileSync(
    npx,
    ['--yes', '@vscode/vsce@3', 'package', '--skip-license', '--allow-missing-repository', ...(preRelease ? ['--pre-release'] : []), '--out', join(out, file)],
    { cwd: stage, stdio: 'inherit', env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` } },
  );
} catch (err) {
  console.error(`vsce failed, manifest written without a VSIX: ${err.message}`);
  process.exit(1);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
copyFileSync(join(out, file), join(out, stable));
console.log(`wrote ${join(out, file)}, ${stable} and manifest.json`);

/** The Marketplace takes only x.y.z, so a train version x.y.z-beta.n becomes x.y.(1000z + n) and a release x.y.z becomes x.y.(1000z + 999). */
function extensionVersion(train) {
  const [, major, minor, patch, pre] = /^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(train) ?? [];
  if (major === undefined) throw new Error(`not a version: ${train}`);
  const last = pre?.split('.').at(-1);
  const n = pre === undefined ? 999 : /^\d+$/.test(last) ? Number(last) : 0;
  if (n > 999) throw new Error(`pre-release number over 999: ${train}`);
  return `${major}.${minor}.${Number(patch) * 1000 + n}`;
}

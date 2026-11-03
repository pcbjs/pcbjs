// Bundles the extension into dist/extension.js and the modules the tests load into dist/*.cjs, vscode left external for the
// fake in tests/vscode.mjs. The board, the values and their edits live in the dev server, so the bundle has no compiler.
// Then copies the brand icons into assets/.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brand = resolve(here, '../../site/brand/icons')

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: true,
  logLevel: 'warning',
  // Optional native speedups that ws loads inside try/catch.
  external: ['vscode', 'bufferutil', 'utf-8-validate'],
}

await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' })
for (const name of [
  'setup',
  'dev-suite',
  'examples',
  'wizard',
  'link',
  'merge3',
  'merge',
  'agents',
  'send',
  'worktrees',
  'server',
  'sync',
  'protocol',
  'lsp-client',
  'hover',
  'icon-map',
  'icons',
  'drafts',
  'views',
  'tree-data',
  'preview',
  'reveal',
  'sidebar',
  'auto-icons',
  'fab',
  'fab-panel',
  'version',
  'install',
  'recommend',
  'phase',
  'owner',
  'status',
  'segments-ui',
  'pad-hints',
  'wiring',
  'finding-column',
]) {
  await build({ ...common, minify: false, entryPoints: [`src/${name}.ts`], outfile: `dist/${name}.cjs` })
}

// the keybindings come from the key map table the views read, so the editor and the viewer agree
const ui = dirname(createRequire(import.meta.url).resolve('@pcbjs/ui/package.json'))
await build({ ...common, minify: false, entryPoints: [join(ui, 'src/keys.ts')], outfile: 'dist/keys.cjs' })
const { vscodeKeybindings } = await import(join(here, 'dist/keys.cjs')).then(m => m.default ?? m)
const manifest = join(here, 'package.json')
const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
const keys = vscodeKeybindings()
if (JSON.stringify(pkg.contributes.keybindings) !== JSON.stringify(keys)) {
  pkg.contributes.keybindings = keys
  writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n')
}

const { ICONS, vsiconsName } = await import(join(here, 'dist/icon-map.cjs')).then(m => m.default ?? m)
const assets = join(here, 'assets')
const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}
for (const dir of ['icons', 'vsicons', 'material']) rmSync(join(assets, dir), { recursive: true, force: true })
// the 16 px file icon box: the chip ink, 32 to 480 of 512, drawn 13 px, centred upright and 0.5 px off the right like a Seti glyph
const tree = (from, to) => {
  const inner = readFileSync(from, 'utf8')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><svg x="2.5" y="1.5" width="13" height="13" viewBox="32 32 448 448">${inner}</svg></svg>\n`)
}
for (const icon of ICONS) {
  for (const theme of ['light', 'dark']) {
    copy(join(brand, theme, `${icon}.svg`), join(assets, 'icons', theme, `${icon}.svg`))
    tree(join(brand, theme, `${icon}.svg`), join(assets, 'icons', 'tree', theme, `${icon}.svg`))
  }
  if (icon === 'preview') continue
  // vscode-icons reads `file_type_<name>.svg` and `file_type_light_<name>.svg` from `vsicons-custom-icons` in its custom folder
  const custom = join(assets, 'vsicons', 'vsicons-custom-icons')
  tree(join(brand, 'dark', `${icon}.svg`), join(custom, `file_type_${vsiconsName(icon)}.svg`))
  tree(join(brand, 'light', `${icon}.svg`), join(custom, `file_type_light_${vsiconsName(icon)}.svg`))
}
// the activity bar takes one colour and masks it
copy(resolve(brand, '..', 'mark-mono.svg'), join(assets, 'icons', 'mark-mono.svg'))
const fab = join(brand, 'dark', 'fab.svg')
tree(fab, join(assets, 'vsicons', 'vsicons-custom-icons', `folder_type_${vsiconsName('fab')}.svg`))
tree(fab, join(assets, 'vsicons', 'vsicons-custom-icons', `folder_type_${vsiconsName('fab')}_opened.svg`))
// Material Icon Theme wants the closed and the open folder beside each other
tree(fab, join(assets, 'material', 'folder-pcbjs-fab.svg'))
tree(fab, join(assets, 'material', 'folder-pcbjs-fab-open.svg'))
// the Marketplace and Open VSX listing icon must be a PNG: the 512 px mark on a transparent ground
copy(resolve(brand, '..', 'icon.png'), join(assets, 'icon.png'))

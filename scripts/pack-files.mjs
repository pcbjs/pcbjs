// prepack and postpack of every published package, run in the package directory: `node ../../scripts/pack-files.mjs pre|post`.
// Copies the root LICENSE in, for @pcbjs/lib LICENSES.md with the KiCad attribution, and for @pcbjs/cli the docs, and checks the bundled VSIX
// and the library build of @pcbjs/ui, which ships dist only, are there.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const name = JSON.parse(readFileSync('package.json', 'utf8')).name
const cli = name === '@pcbjs/cli'
const lib = name === '@pcbjs/lib'
const ui = name === '@pcbjs/ui'

if (process.argv[2] === 'post') {
  rmSync('LICENSE', { force: true })
  if (lib) rmSync('LICENSES.md', { force: true })
  if (cli) rmSync('docs', { recursive: true, force: true })
} else {
  copyFileSync(join(root, 'LICENSE'), 'LICENSE')
  if (lib) copyFileSync(join(root, 'LICENSES.md'), 'LICENSES.md')
  if (ui && !['dist/index.js', 'dist/index.d.ts', 'dist/style.css'].every(f => existsSync(f))) {
    console.error('@pcbjs/ui: dist lacks the library build. Run `npm run build` first.')
    process.exit(1)
  }
  if (cli) {
    rmSync('docs', { recursive: true, force: true })
    mkdirSync('docs')
    for (const f of readdirSync(join(root, 'docs'))) if (f.endsWith('.md')) copyFileSync(join(root, 'docs', f), join('docs', f))
    const manifest = 'vscode/manifest.json'
    const vsix = existsSync(manifest) && join('vscode', JSON.parse(readFileSync(manifest, 'utf8')).file)
    const want = JSON.parse(readFileSync(join(root, 'packages/vscode/package.json'), 'utf8')).version
    if (!vsix || !existsSync(vsix) || JSON.parse(readFileSync(manifest, 'utf8')).train !== want) {
      console.error(`@pcbjs/cli: packages/cli/vscode has no VSIX of version ${want}. Run \`npm run package -w @pcbjs/vscode\` first.`)
      process.exit(1)
    }
  }
}

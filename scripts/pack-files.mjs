// prepack and postpack of every published package, run in the package directory: `node ../../scripts/pack-files.mjs pre|post`.
// Copies the root LICENSE in, and for @pcbjs/cli the docs, and checks the bundled VSIX is there.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const name = JSON.parse(readFileSync('package.json', 'utf8')).name
const cli = name === '@pcbjs/cli'

if (process.argv[2] === 'post') {
  rmSync('LICENSE', { force: true })
  if (cli) rmSync('docs', { recursive: true, force: true })
} else {
  copyFileSync(join(root, 'LICENSE'), 'LICENSE')
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

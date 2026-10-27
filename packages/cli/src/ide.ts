import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PKG_DIR } from './vite.js'

/** `version` is the Marketplace version of the VSIX, `train` the version of @pcbjs/vscode it was packaged from. */
export interface ExtensionManifest { name: string; publisher: string; version: string; train?: string; preRelease?: boolean; id: string; file: string }

export const VSCODE_DIR = join(PKG_DIR, 'vscode')
const CODE = process.platform === 'win32' ? 'code.cmd' : 'code'

/** The bundled extension's manifest and the absolute path of its .vsix, null when the package ships none. */
export function bundledExtension(dir = VSCODE_DIR): (ExtensionManifest & { vsix: string }) | null {
  const f = join(dir, 'manifest.json')
  if (!existsSync(f)) return null
  const m = JSON.parse(readFileSync(f, 'utf8')) as ExtensionManifest
  return { ...m, id: m.id ?? `${m.publisher}.${m.name}`, vsix: join(dir, m.file ?? 'vscode-pcbjs.vsix') }
}

interface Run { code: number | null; stdout: string; stderr: string; missing: boolean }

/** Run the `code` CLI from the current environment, so VSCODE_IPC_HOOK_CLI picks the window this terminal belongs to. */
export function runCode(args: string[], timeout = 60_000): Promise<Run> {
  return new Promise(done => {
    execFile(CODE, args, { timeout, encoding: 'utf8', shell: process.platform === 'win32' }, (err: any, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: stdout ?? '', stderr: stderr ?? '', missing: err?.code === 'ENOENT' })
    })
  })
}

/** The installed version of `id` in `code --list-extensions --show-versions` output, null when it is not listed. */
export function installedVersion(listing: string, id: string): string | null {
  const want = id.toLowerCase()
  for (const line of listing.split(/\r?\n/)) {
    const at = line.trim().lastIndexOf('@')
    if (at > 0 && line.trim().slice(0, at).toLowerCase() === want) return line.trim().slice(at + 1)
  }
  return null
}

/** -1, 0 or 1 as a is older than, equal to or newer than b, by semver precedence, pre-release tags included. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => { const [core, pre] = v.split('+')[0].split(/-(.*)/s); return { nums: core.split('.').map(Number), pre: pre ? pre.split('.') : [] } }
  const x = parse(a), y = parse(b)
  for (let i = 0; i < 3; i++) { const d = (x.nums[i] || 0) - (y.nums[i] || 0); if (d) return Math.sign(d) }
  // semver: a release is newer than its pre-releases; identifiers compare numerically when both are numbers, else as text
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length)
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i]
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1
    const np = /^\d+$/.test(p), nq = /^\d+$/.test(q)
    const d = np && nq ? Number(p) - Number(q) : np ? -1 : nq ? 1 : p < q ? -1 : p > q ? 1 : 0
    if (d) return Math.sign(d)
  }
  return 0
}

/** A version in the Marketplace scheme: a train pre-release x.y.z-beta.n becomes x.y.(1000z + n), as scripts/package.mjs of @pcbjs/vscode packs it; a plain one is already. */
export function marketVersion(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)-([^+]*)/.exec(v)
  if (!m) return v
  const last = m[4].split('.').at(-1)!
  return `${m[1]}.${m[2]}.${Number(m[3]) * 1000 + (/^\d+$/.test(last) ? Number(last) : 0)}`
}

/** compareVersions of two extension versions, each in either scheme. */
export const compareExtensions = (a: string, b: string): number => compareVersions(marketVersion(a), marketVersion(b))

/** `pcbjs ide install`: hand the bundled .vsix to `code` with --force so a rebuild of the same version replaces the installed one, or print the command when `code` is not on PATH. */
export async function ideInstall(dir = VSCODE_DIR): Promise<number> {
  const ext = bundledExtension(dir)
  if (!ext || !existsSync(ext.vsix)) { console.error(`pcbjs: no bundled VS Code extension in ${dir}`); return 1 }
  const args = ['--install-extension', ext.vsix, '--force']
  const r = await runCode(args)
  if (r.missing) {
    console.log(`The \`code\` command is not on PATH. Install the extension with:\n\n  code ${args.map(a => JSON.stringify(a)).join(' ')}\n\nor in VS Code: Extensions view, ..., Install from VSIX, and pick ${ext.vsix}`)
    return 1
  }
  process.stdout.write(r.stdout); process.stderr.write(r.stderr)
  return r.code ?? 1
}

/** `pcbjs ide status`: the bundled version and the installed one. */
export async function ideStatus(dir = VSCODE_DIR): Promise<number> {
  const ext = bundledExtension(dir)
  if (!ext) { console.log(`bundled      none (no ${join(dir, 'manifest.json')})`); return 1 }
  console.log(`bundled      ${ext.id} ${ext.version}${ext.train ? ` (@pcbjs/vscode ${ext.train})` : ''}  ${ext.vsix}`)
  const r = await runCode(['--list-extensions', '--show-versions'])
  if (r.missing) { console.log('installed    unknown, the `code` command is not on PATH'); return 1 }
  const v = installedVersion(r.stdout, ext.id)
  if (!v) { console.log('installed    no, run `pcbjs ide install`'); return 1 }
  const cmp = compareExtensions(v, ext.version)
  console.log(`installed    ${v}${cmp < 0 ? ', outdated: run `pcbjs ide install`' : ''}`)
  return 0
}

/** The hint `pcbjs dev` prints when the extension is missing or older than the bundled one; null otherwise or on timeout. */
export async function extensionHint(dir = VSCODE_DIR, timeout = 3000): Promise<string | null> {
  const ext = bundledExtension(dir)
  if (!ext) return null
  const r = await runCode(['--list-extensions', '--show-versions'], timeout)
  if (r.missing || r.code !== 0) return null
  const v = installedVersion(r.stdout, ext.id)
  if (!v) return '  vscode     extension not installed: run `pcbjs ide install` for cursor sync and range selection'
  if (compareExtensions(v, ext.version) < 0) return `  vscode     extension outdated (${v} installed, ${ext.version} bundled): run \`pcbjs ide install\``
  return null
}

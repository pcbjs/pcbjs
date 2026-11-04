// Explicit opt-in only: launches a private VS Code host, never an existing user profile.
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { webviewAction } from './probe.mjs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { hostPaths } from './platform.mjs'
import { writeJson } from './report.cjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
if (!args.includes('--vsix') || !args.includes('--repo'))
  throw new Error('Usage: node run.mjs --vsix candidate.vsix --repo built-clean-clone [--code executable] [--cli executable] [--out report-folder]')
const repo = resolve(option('--repo'))
const vsix = resolve(option('--vsix'))
const { code, cli, node } = hostPaths({ code: args.includes('--code') ? resolve(option('--code')) : undefined, cli: args.includes('--cli') ? resolve(option('--cli')) : undefined })
const headless = args.includes('--headless')
if (headless && (process.platform !== 'linux' || !process.env.DISPLAY || !process.env.PCBJS_TEST_VIRTUAL_DISPLAY))
  throw new Error('Use npm run test:vscode:headless to create a private Linux virtual display')
if (headless && args.some(a => a.startsWith('--diagnose-') || ['--pad-hints-api-only', '--finding-groups-only', '--devtools-only'].includes(a)))
  throw new Error('Headless acceptance runs the full suite; diagnostic subsets are not allowed')
if (!existsSync(vsix) || !existsSync(code) || !existsSync(cli)) throw new Error('Candidate VSIX or VS Code executable/CLI is missing')
const out = args.includes('--out') ? resolve(option('--out')) : mkdtempSync(join(tmpdir(), 'pcbjs-installed-host-report-'))
mkdirSync(out, { recursive: true })
// Never accept a probe or result left by an earlier run in the same report folder.
for (const name of ['host-results.json', 'webview-ack.json', 'webview-probes.json']) rmSync(join(out, name), { force: true })
writeFileSync(
  join(out, 'environment.json'),
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      mode: headless ? 'linux-virtual-display' : 'desktop',
      code,
      vsix,
      sha256: createHash('sha256').update(readFileSync(vsix)).digest('hex'),
    },
    null,
    2,
  ),
)
const scratch = realpathSync(mkdtempSync('/tmp/pcbjs-vsc-'))
const profile = join(scratch, 'profile'),
  extensions = join(scratch, 'extensions'),
  runtime = join(scratch, 'run')
for (const p of [profile, extensions, runtime]) mkdirSync(p, { mode: 0o700 })
mkdirSync(join(profile, 'User'))
writeFileSync(
  join(profile, 'User/settings.json'),
  JSON.stringify({
    'pcbjs.nodePath': node,
    'pcbjs.autoStart': false,
    'pcbjs.editorAutoSave': false,
    'files.autoSave': 'off',
    'security.workspace.trust.enabled': false,
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'workbench.startupEditor': 'none',
    'workbench.enableExperiments': false,
  }),
)
for (const name of ['demo', 'badge']) {
  const from = join(repo, 'examples', name),
    target = join(scratch, name)
  cpSync(from, target, { recursive: true, filter: f => !/\/(node_modules|\.pcbjs)(\/|$)/.test(f.slice(from.length)) })
  mkdirSync(join(target, 'node_modules'))
  symlinkSync(join(repo, 'node_modules/@pcbjs'), join(target, 'node_modules/@pcbjs'))
}
const workspace = join(scratch, 'host.code-workspace')
writeFileSync(workspace, JSON.stringify({ folders: [{ path: join(scratch, 'demo') }, { path: join(scratch, 'badge') }] }))
const report = join(out, 'host-results.json')
const ack = join(out, 'webview-ack.json')
const reservation = createServer()
await new Promise(r => reservation.listen(0, '127.0.0.1', r))
const debugPort = reservation.address().port
await new Promise(r => reservation.close(r))
writeFileSync(join(out, 'connection.json'), JSON.stringify({ debugPort, scratch, profile, extensions }, null, 2))
const env = {
  ...process.env,
  XDG_RUNTIME_DIR: runtime,
  PCBJS_HOST_REPORT: report,
  PCBJS_HOST_ACK: ack,
  PCBJS_HOST_EXTENSIONS: extensions,
  PATH: `${dirname(node)}:${process.env.PATH}`,
}
for (const key of ['PCBJS_HOST_DEVTOOLS', 'PCBJS_HOST_PAD_API', 'PCBJS_HOST_FINDING_GROUPS', 'PCBJS_HOST_DIAGNOSE', 'PCBJS_HOST_WAIT']) delete env[key]
if (args.includes('--devtools-only')) env.PCBJS_HOST_DEVTOOLS = '1'
if (args.includes('--pad-hints-api-only')) env.PCBJS_HOST_PAD_API = '1'
if (args.includes('--finding-groups-only')) env.PCBJS_HOST_FINDING_GROUPS = '1'
if (args.includes('--diagnose-undo')) env.PCBJS_HOST_DIAGNOSE = '1'
if (args.includes('--diagnose-focus-command')) env.PCBJS_HOST_DIAGNOSE = 'focus-command'
delete env.ELECTRON_RUN_AS_NODE
let child
let hostRunning = false
const probeResults = []
const run = (exe, argv, log) =>
  new Promise((done, fail) => {
    child = spawn(exe, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', b => (text += b))
    child.stderr.on('data', b => (text += b))
    child.on('error', fail)
    child.on('exit', status => {
      writeFileSync(join(out, log), text)
      status === 0 ? done() : fail(new Error(`${exe} exited ${status}; see ${log}`))
    })
  })
const stop = () => child?.kill('SIGTERM')
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
const timer = setTimeout(stop, headless ? 600000 : 240000)
try {
  const sandboxArgs = headless ? ['--no-sandbox', '--disable-gpu-sandbox'] : []
  await run(cli, [...sandboxArgs, '--user-data-dir', profile, '--extensions-dir', extensions, '--install-extension', vsix, '--force'], 'install.log')
  hostRunning = true
  const host = run(
    code,
    [
      workspace,
      ...sandboxArgs,
      '--new-window',
      '--user-data-dir',
      profile,
      '--extensions-dir',
      extensions,
      '--extensionDevelopmentPath=' + here,
      '--extensionTestsPath=' + join(here, 'suite.cjs'),
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-updates',
      ...(headless ? ['--ozone-platform=x11', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
      ...(args.includes('--diagnose-undo') ? ['--log', 'trace'] : []),
      '--remote-debugging-port=' + debugPort,
    ],
    'host.log',
  ).finally(() => {
    hostRunning = false
  })
  const observe = (async () => {
    const handled = new Set()
    while (hostRunning) {
      if (existsSync(report)) {
        const action = JSON.parse(readFileSync(report, 'utf8')).probe
        if (action && !handled.has(action.id)) {
          if (action.kind === 'activate-workbench' && process.platform === 'darwin') {
            // Electron's Page.bringToFront does not activate a separate macOS process.
            // Address the owned PID, never the shared bundle ID or owner's window.
            execFileSync(
              '/usr/bin/osascript',
              ['-l', 'JavaScript', '-e', `ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid}).activateWithOptions(2)`],
              { timeout: 10000 },
            )
          }
          const evidence = await webviewAction(debugPort, action, out).catch(() => null)
          if (evidence) {
            handled.add(action.id)
            probeResults.push(evidence)
            writeJson(join(out, 'webview-probes.json'), probeResults)
            writeJson(ack, { id: action.id, evidence, ...(evidence.error ? { error: evidence.error } : {}) })
          }
        }
      }
      await new Promise(r => setTimeout(r, 250))
    }
  })()
  await Promise.all([host, observe])
  if (args.includes('--diagnose-undo')) cpSync(join(profile, 'logs'), join(out, 'vscode-logs'), { recursive: true })
  const result = JSON.parse(readFileSync(report, 'utf8'))
  if (result.failures.length) throw new Error('Installed-host checks failed; see host-results.json')
  if (headless && result.stage !== 'host-api-complete') throw new Error('Headless acceptance did not finish the full suite')
  console.log(`Installed VS Code host: ${result.checks.length} checks passed; report ${report}`)
} finally {
  clearTimeout(timer)
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
  child?.kill('SIGTERM')
  for (const name of ['demo', 'badge']) {
    const project = join(scratch, name)
    const info = join(project, '.pcbjs/dev.json')
    if (existsSync(info)) {
      const dev = JSON.parse(readFileSync(info, 'utf8'))
      if (dev.root?.startsWith(scratch) && Number.isInteger(dev.pid))
        try {
          process.kill(dev.pid, 'SIGTERM')
        } catch {}
    }
    const logs = join(project, '.pcbjs/log')
    if (existsSync(logs)) for (const file of readdirSync(logs)) cpSync(join(logs, file), join(out, `${name}-${file}`))
  }
  const owned = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter(line => line.includes(scratch))
    .map(line => ({ pid: Number(line.trim().match(/^\d+/)?.[0]), command: line.trim() }))
    .filter(p => Number.isInteger(p.pid) && p.pid !== process.pid)
  writeFileSync(join(out, 'cleanup-processes.json'), JSON.stringify(owned, null, 2))
  for (const p of owned)
    try {
      process.kill(p.pid, 'SIGTERM')
    } catch {}
  if (existsSync(join(profile, 'logs'))) cpSync(join(profile, 'logs'), join(out, 'vscode-logs'), { recursive: true })
  rmSync(scratch, { recursive: true, force: true })
}

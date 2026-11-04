import * as fs from 'node:fs'
import * as path from 'node:path'
import { SessionLink, alive, readDevInfo } from './link'

const markers = ['packages/vscode/src/extension.ts', 'packages/core/src/index.ts', 'packages/pcbjs/bin/pcbjs.js']
const within = (root: string, file: string) => file === root || file.startsWith(root + path.sep)

/** A development flag alone never makes an arbitrary workspace a build target. */
export function suiteRoot(folders: string[]): string {
  const found = new Set<string>()
  for (const folder of folders) {
    let dir = fs.realpathSync(folder)
    for (;;) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
        if (pkg.name === 'pcbjs-workspace' && markers.every(p => fs.existsSync(path.join(dir, p)))) {
          found.add(dir)
          break
        }
      } catch {}
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  if (found.size !== 1) throw new Error('Open exactly one pcbjs source checkout to purge and reload its development suite.')
  return [...found][0]
}

export function suiteFolders(root: string, folders: string[]): string[] {
  const all = new Set([root])
  for (const folder of folders) {
    try {
      const dir = fs.realpathSync(folder)
      if (within(root, dir)) all.add(dir)
    } catch {}
  }
  return [...all]
}

/** Uses the extension transport, so recovery still works after a failed core build. */
export async function stopSuite(root: string, folders: string[]): Promise<void> {
  const sessions = new Map<string, NonNullable<ReturnType<typeof readDevInfo>>>()
  for (const dir of suiteFolders(root, folders)) {
    const info = readDevInfo(dir)
    if (!info || !alive(info.pid)) continue
    if (!within(root, fs.realpathSync(info.root)) || (info.checkout && fs.realpathSync(info.checkout) !== root))
      throw new Error(`A session from outside this checkout serves ${dir}; detach it before purging.`)
    sessions.set(info.session, info)
  }
  for (const info of sessions.values()) {
    const link = await SessionLink.connect(info, { name: 'vscode-pcbjs-purge', version: 'dev', timeoutMs: 3000 })
    try {
      if (link.info?.session !== info.session || link.info.pid !== info.pid) throw new Error('The session record changed; rerun purge to refresh it.')
      await link.request('session/stop', undefined, 5000)
    } finally {
      link.close()
    }
    const deadline = Date.now() + 10000
    while (alive(info.pid) && Date.now() < deadline) await new Promise(done => setTimeout(done, 100))
    if (alive(info.pid)) throw new Error(`Session ${info.session} did not stop; no caches were removed.`)
  }
}

export interface SuiteHost {
  signal?: AbortSignal
  development(): boolean
  folders(): string[]
  projects(): string[]
  save(): PromiseLike<boolean>
  disconnect(): Promise<void>
  stop(root: string, folders: string[]): Promise<void>
  run(tool: 'npm' | 'pcbjs', args: string[], root: string): Promise<void>
  reload(): PromiseLike<unknown>
  progress(message: string): void
}

/** One invocation per window; every failed step prevents installation and reload after it. */
export class DevSuite {
  private pending?: Promise<boolean>

  run(host: SuiteHost): Promise<boolean> {
    if (this.pending) return this.pending
    const pending = this.purge(host)
    this.pending = pending
    void pending
      .finally(() => {
        if (this.pending === pending) this.pending = undefined
      })
      .catch(() => {})
    return pending
  }

  private async purge(h: SuiteHost): Promise<boolean> {
    const check = () => {
      if (h.signal?.aborted) throw new Error('The window closed during development maintenance.')
    }
    const progress = (message: string) => {
      check()
      h.progress(message)
    }
    check()
    if (!h.development()) throw new Error('Purge Reload Dev Suite is available only in development mode.')
    const root = suiteRoot(h.folders())
    const folders = suiteFolders(root, h.projects())
    progress('Saving source edits')
    if (!(await h.save())) return false
    progress('Disconnecting previews and language services')
    await h.disconnect()
    progress('Stopping this checkout’s PCB sessions')
    await h.stop(root, folders)
    progress('Clean-building core and preview UI')
    await h.run('npm', ['run', 'clean'], root)
    check()
    await h.run('npm', ['run', 'build'], root)
    progress('Clearing project, routing and model caches')
    await h.run('pcbjs', ['cache', 'clear', '--models', root], root)
    progress('Packaging and reinstalling the extension')
    await h.run('npm', ['run', 'package', '-w', '@pcbjs/vscode'], root)
    check()
    await h.run('pcbjs', ['ide', 'install'], root)
    progress('Reloading the window')
    await h.reload()
    return true
  }
}

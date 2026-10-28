import { existsSync, globSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { loadConfigFromFile } from 'vite'
import type { UserConfig } from '@pcbjs/core/config'
import { setKicadConfig } from '@pcbjs/kicad/library'
import { setFontConfig } from '@pcbjs/core/outline'

export interface Entry {
  /** absolute path of the module */
  file: string
  /** the path relative to the project root, forward slashes */
  rel: string
}

export interface ResolvedConfig {
  root: string
  configFile: string | null
  /** the design entries in order, from the command line or the config's `entries`, each default-exporting <PCB> */
  entries: Entry[]
  outDir: string
  fabDir: string
  base: string
  vite: UserConfig['vite']
  repo: UserConfig['repo']
  /** how the viewer follows a click to the source, from `editor.follow` */
  editor: { follow: FollowMode }
  /** read every copper and outline Gerber back and compare it with the board: set by `pcbjs build` and `pcbjs check --fab` */
  fabCheck?: boolean
  /** the date every fab file carries, ISO 8601; absent means SOURCE_DATE_EPOCH, else the time of each compile */
  fabDate?: string
}

export type FollowMode = 'click' | 'meta-click'

/** The config file names, looked up in this order in the project root. */
export const CONFIG_NAMES = ['pcb.config.ts', 'pcb.config.mts', 'pcb.config.js', 'pcb.config.mjs']
/** The names before the rename, still loaded with a deprecation warning when none of the new ones exists. */
export const LEGACY_CONFIG_NAMES = ['pcbjs.config.ts', 'pcbjs.config.mts', 'pcbjs.config.js', 'pcbjs.config.mjs']

/** The config file of a project: the first new name that exists, else the first old one, flagged `legacy`. */
export function findConfig(root: string, exists: (file: string) => boolean = existsSync): { file: string; legacy: boolean } | null {
  for (const c of CONFIG_NAMES) if (exists(resolve(root, c))) return { file: resolve(root, c), legacy: false }
  for (const c of LEGACY_CONFIG_NAMES) if (exists(resolve(root, c))) return { file: resolve(root, c), legacy: true }
  return null
}

/** The one-line warning for a config file found under its old name. */
export const legacyWarning = (file: string): string => {
  const name = file.split(/[\\/]/).pop()!
  return `pcbjs: ${name} is deprecated, rename it to ${name.replace(/^pcbjs\./, 'pcb.')}`
}

/** `editor.follow` checked: 'click' unless the config says 'meta-click'. */
export function followMode(v: unknown, warn: (msg: string) => void = console.warn): FollowMode {
  if (v === undefined || v === 'click') return 'click'
  if (v === 'meta-click') return 'meta-click'
  warn(`pcbjs: editor.follow must be "click" or "meta-click", got ${JSON.stringify(v)}; using "click"`)
  return 'click'
}

const isGlob = (p: string): boolean => /[*?[\]{}]/.test(p)

/** The files of a config's `entries`, relative to its directory, globs expanded and sorted, no duplicates; a missing path or empty glob throws. */
export function expandEntries(patterns: string[], dir: string, shown: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of patterns) {
    if (typeof p !== 'string' || !p) throw new Error(`entries in ${shown} must be a list of paths, got ${JSON.stringify(p)}`)
    let files: string[]
    if (isGlob(p)) {
      files = globSync(p, { cwd: dir, exclude: (f: string) => f === 'node_modules' || f === '.pcbjs' })
        .map(f => resolve(dir, f))
        .filter(f => statSync(f).isFile())
        .sort()
      if (!files.length) throw new Error(`no file matches the entry pattern ${JSON.stringify(p)} in ${shown}`)
    } else {
      const f = resolve(dir, p)
      if (!existsSync(f)) throw new Error(`entry not found: ${p}, listed in entries in ${shown}`)
      files = [f]
    }
    for (const f of files)
      if (!seen.has(f)) {
        seen.add(f)
        out.push(f)
      }
  }
  return out
}

/** Where the entries of a run come from: the command line, else the config, else nothing, which is an error. */
export interface EntrySource {
  /** absolute entry files */
  files: string[]
  from: 'command line' | 'config'
  /** the one line printed when the command line overrides the config's entries, null otherwise */
  note: string | null
}

/** The entries of a run: the command line's, else the config's `entries`, else an error. */
export function pickEntries(cli: string[], configEntries: unknown, o: { root: string; configFile: string | null; shown: string | null }): EntrySource {
  const listed = configEntries === undefined || configEntries === null ? [] : configEntries
  if (!Array.isArray(listed)) throw new Error(`entries in ${o.shown} must be a list of paths such as ['pcb.tsx'], got ${JSON.stringify(listed)}`)
  const fromConfig = listed.length && o.configFile ? expandEntries(listed, dirname(o.configFile), o.shown!) : []
  if (cli.length) {
    const files = cli.map(e => {
      const f = isAbsolute(e) ? e : resolve(o.root, e)
      if (!existsSync(f)) throw new Error(`entry not found: ${e}`)
      return f
    })
    const same = files.length === fromConfig.length && files.every((f, i) => f === fromConfig[i])
    const note = fromConfig.length && !same ? `pcbjs: using the entries on the command line for this run, not the ${fromConfig.length} in ${o.shown}` : null
    return { files, from: 'command line', note }
  }
  if (fromConfig.length) return { files: fromConfig, from: 'config', note: null }
  const name = o.shown ?? 'pcb.config.ts'
  throw new Error(
    o.configFile
      ? `no entries: add entries: ['pcb.tsx'] to ${name}, or pass the entries on the command line`
      : `no entries: create ${name} with export default defineConfig({ entries: ['pcb.tsx'] }), or pass the entries on the command line`,
  )
}

/** The config file and what it exports, without the entries: for a command that only needs the settings. */
export async function loadUserConfig(
  command: 'serve' | 'build',
  configArg?: string,
  root = process.cwd(),
): Promise<{ root: string; file: string | null; shown: string | null; user: UserConfig & { entry?: unknown; title?: unknown } }> {
  root = resolve(root)
  let file: string | null = configArg ? resolve(root, configArg) : null
  if (!file) {
    const found = findConfig(root)
    if (found?.legacy) console.warn(legacyWarning(found.file))
    file = found?.file ?? null
  }
  let user: UserConfig & { entry?: unknown; title?: unknown } = {}
  if (file) {
    if (!existsSync(file)) throw new Error(`config not found: ${configArg}`)
    const loaded = await loadConfigFromFile({ command, mode: command === 'build' ? 'production' : 'development' }, file, root, 'silent')
    user = (loaded?.config ?? {}) as UserConfig
  }
  // kicadFootprint() in the design reads the project's KiCad library folders from here
  setKicadConfig(file ? dirname(file) : root, user.kicad)
  // <text font="name"> finds the outline fonts of the config here, files relative to the config
  setFontConfig(file ? dirname(file) : root, user.fonts)
  const shown = file ? (!relative(root, file).startsWith('..') ? relative(root, file) : file) : null
  return { root, file, shown, user }
}

/** The config of the project in the working directory, entries by pickEntries. */
export async function resolveConfig(
  entries: string[],
  command: 'serve' | 'build',
  configArg?: string,
  root = process.cwd(),
  log: (line: string) => void = l => console.log(l),
): Promise<ResolvedConfig> {
  const loaded = await loadUserConfig(command, configArg, root)
  return configFrom(loaded, entries, log)
}

/** A ResolvedConfig from a loaded config and the command line entries. */
export function configFrom(loaded: Awaited<ReturnType<typeof loadUserConfig>>, entries: string[], log: (line: string) => void = l => console.log(l)): ResolvedConfig {
  const { root, file, shown, user } = loaded
  if (user.entry !== undefined) console.warn(`pcbjs: "entry" in ${shown} is ignored, list the entries as entries: [${JSON.stringify(user.entry)}]`)
  if (user.title !== undefined) console.warn(`pcbjs: "title" in ${shown} is ignored, the site shows each board's own title`)
  const picked = pickEntries(entries, user.entries, { root, configFile: file, shown: shown ?? 'pcb.config.ts' })
  if (picked.note) log(picked.note)
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(root, p))
  const seen = new Set<string>()
  const list: Entry[] = []
  for (const f of picked.files) {
    if (seen.has(f)) continue
    seen.add(f)
    list.push({ file: f, rel: relative(root, f).split('\\').join('/') })
  }
  return {
    root,
    configFile: file,
    entries: list,
    outDir: abs(user.outDir ?? '.pcbjs/dist'),
    fabDir: abs(user.fabDir ?? '.pcbjs/fab'),
    base: user.base ?? '/',
    vite: user.vite,
    repo: user.repo,
    editor: { follow: followMode(user.editor?.follow) },
  }
}
